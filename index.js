/**
 * dsh-archive-purge — Host half.
 *
 * Owns the one thing the shipped composition deliberately refuses to do:
 * permanently removing a session. DSH can archive a session but never delete
 * one (`dsh-client-ui-workspace` documents “没有 Session 删除”, and
 * `dsh-session-persistence` documents “不删除会话文件 … seam 无删除接口”), so
 * the erase path lives here and is reachable only for sessions that are
 * *currently archived*.
 *
 * What one erase removes, exactly:
 *   1. the session's own directory under `<DSH_HOME>/sessions/<project>/<id>/`
 *      (every JSONL generation plus any session-local artifact in it),
 *   2. the session's projection-cache record
 *      (`<DSH_HOME>/storages/session_projcache/sessions/<id>.json`),
 *   3. its archive and pin bookkeeping in the workspace registry.
 *
 * What it deliberately keeps: attachment blobs, which are content-addressed and
 * therefore shared between sessions, and every other session's files.
 *
 * Refusals are part of the contract, not an afterthought: a session that is
 * live in this process — or that any `workspace/session-activity` provider
 * still reports work for — is never touched.
 *
 * @module dsh-archive-purge
 */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/** Route prefix owned by this plugin. */
const ROUTE = '/api/archive-purge'
/** Harness-home subdirectory holding every session log. */
const SESSIONS_SEGMENT = 'sessions'
/** Harness-home subdirectory holding storage domains. */
const STORAGES_SEGMENT = 'storages'
/** Storage domain and table that hold per-session projection checkpoints. */
const PROJ_CACHE_DOMAIN = 'session_projcache'
const PROJ_CACHE_TABLE = 'sessions'
/** A physical session artifact in any released format generation. */
const LOG_FILE = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/
/** Session ids are branded strings; only this shape may become a filename. */
const SAFE_FILE_ID = /^[A-Za-z0-9._-]+$/
/** Bound on a request body: every caller sends a small id list. */
const MAX_BODY_BYTES = 1 << 20

/**
 * Cordis services this plugin needs. `sessions`/`agents` are read optionally
 * so a composition without the agent loop still loads.
 */
export const inject = ['webServer', 'workspaceRegistry', 'sessionPersistence']

/**
 * Expand the one tilde form the harness home accepts.
 * @param path - configured path that may start with `~`.
 * @returns the expanded path.
 */
function expandHome(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the harness home exactly as `@deepseek-ai/dsh-home-paths` does:
 * `$DSH_HOME` wins, otherwise `~/.dsh`, both resolved against the cwd.
 * @returns the absolute harness home.
 */
function resolveHome() {
  const fromEnv = process.env.DSH_HOME
  const base = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(expandHome(base))
}

/**
 * Encode an arbitrary string as one safe path segment.
 *
 * This is a verbatim copy of the session-persistence backend's own
 * `encodeSegment`: deleting a session means naming the directory that backend
 * created, and re-deriving the name is the only way to reach it. Kept small and
 * total so the two implementations cannot drift in behavior.
 * @param raw - the string to encode; must be non-empty.
 * @returns the escaped single path segment.
 */
function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * Whether `child` is the same path as, or nested under, `parent`.
 * @param parent - the directory that must contain the target.
 * @param child - the candidate path.
 * @returns true when the child is inside the parent.
 */
function isInside(parent, child) {
  const root = resolve(parent)
  const target = resolve(child)
  return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

/**
 * Read a JSON request body.
 * @param req - the incoming request.
 * @returns the parsed body, or undefined when empty.
 * @throws when the body is oversized or is not JSON.
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Write one JSON response.
 * @param res - the response to own.
 * @param status - HTTP status code.
 * @param value - JSON-serializable payload.
 * @param head - whether this is a HEAD request.
 */
function sendJson(res, status, value, head = false) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(head ? undefined : body)
}

/**
 * The three directories this plugin reads and writes.
 * @returns the resolved sessions root, projection-cache directory, and home.
 */
function paths() {
  const home = resolveHome()
  return {
    home,
    sessionsRoot: join(home, SESSIONS_SEGMENT),
    projCacheDir: join(home, STORAGES_SEGMENT, PROJ_CACHE_DOMAIN, PROJ_CACHE_TABLE),
  }
}

/**
 * Enumerate every session directory under the persistence root once.
 *
 * The scan is keyed by the *encoded* session id — the directory name the
 * backend chose — so a lookup never depends on the session's cwd still being
 * known, and a directory is only reported when it actually holds a session log.
 * @param root - the sessions root.
 * @returns encoded id → absolute session directory.
 */
async function scanSessionDirs(root) {
  const found = new Map()
  let projects
  try {
    projects = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectPath = join(root, project.name)
    let entries
    try {
      entries = await fs.readdir(projectPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(projectPath, entry.name)
      let files
      try {
        files = await fs.readdir(dir)
      } catch {
        continue
      }
      if (files.some((file) => LOG_FILE.test(file))) found.set(entry.name, dir)
    }
  }
  return found
}

/**
 * Measure one directory tree.
 * @param dir - the directory to measure.
 * @returns total bytes and file count, or zeroes when unreadable.
 */
async function measureDir(dir) {
  let sizeBytes = 0
  let fileCount = 0
  async function walk(current) {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(child)
        continue
      }
      try {
        const info = await fs.stat(child)
        sizeBytes += info.size
        fileCount += 1
      } catch {
        /* a vanishing file contributes nothing */
      }
    }
  }
  await walk(dir)
  return { sizeBytes, fileCount }
}

/**
 * Report whether a session is loaded, agent-held, or running.
 *
 * Only `agent` and `running` gate an erase: an agent means a writer that may
 * already hold the log's write handle. A session that is merely loaded in the
 * in-memory store is a read mirror — the browser keeps one per rendered row and
 * releases none of them, so refusing on `attached` would make every archived
 * session undeletable after enough browsing, while adding no safety the activity
 * waterfall does not already provide.
 * @param ctx - the plugin context.
 * @param id - the session to inspect.
 * @returns the liveness facts for one session.
 */
function liveness(ctx, id) {
  const session = ctx.get('sessions')?.get(id)
  const agent = ctx.get('agents')?.get(id)
  return {
    attached: session !== undefined,
    agent: agent !== undefined,
    running: agent?.status === 'running',
  }
}

/**
 * Ask every `workspace/session-activity` provider what work a session still
 * owns — the same waterfall the shipped archive action gates on.
 * @param ctx - the plugin context.
 * @param id - the session to inspect.
 * @returns the reported activity entries, or an empty list when unavailable.
 */
async function activityOf(ctx, id) {
  try {
    const reported = await ctx.waterfall('workspace/session-activity', { sessionId: id }, () => Promise.resolve([]))
    return Array.isArray(reported) ? reported : []
  } catch (error) {
    // A dispatcher fault must not read as “nothing is running”: report it so
    // the caller can refuse rather than guess.
    return [{ kind: 'activity-check-failed', label: String(error) }]
  }
}

/**
 * Build the archived-session inventory: registry bookkeeping joined with disk
 * truth. One `sessionPersistence.list()` feeds every header-derived fact.
 * @param ctx - the plugin context.
 * @returns the inventory payload for the client half.
 */
async function inventory(ctx) {
  const { home, sessionsRoot, projCacheDir } = paths()
  const registry = ctx.workspaceRegistry
  const archivedIds = [...registry.archivedSessionIds]
  const archivedSet = new Set(archivedIds)
  let snapshots = []
  let listingError
  try {
    snapshots = await ctx.sessionPersistence.list()
  } catch (error) {
    listingError = String(error)
  }
  const byId = new Map()
  const childrenOf = new Map()
  const persistedIds = []
  for (const snapshot of snapshots) {
    const header = snapshot.header
    byId.set(header.id, snapshot)
    persistedIds.push(header.id)
    const parent = header.parentSession
    if (parent === undefined) continue
    const siblings = childrenOf.get(parent)
    if (siblings === undefined) childrenOf.set(parent, [header.id])
    else siblings.push(header.id)
  }
  const dirs = await scanSessionDirs(sessionsRoot)
  const registryWorkspaces = registry.list()
  const rows = []
  let totalBytes = 0
  for (const id of archivedIds) {
    const snapshot = byId.get(id)
    const cwd = snapshot?.header?.cwd
    let dir
    try {
      dir = dirs.get(encodeSegment(id))
    } catch {
      dir = undefined
    }
    const measured = dir === undefined ? { sizeBytes: 0, fileCount: 0 } : await measureDir(dir)
    totalBytes += measured.sizeBytes
    let cacheBytes = 0
    if (SAFE_FILE_ID.test(id)) {
      try {
        cacheBytes = (await fs.stat(join(projCacheDir, `${id}.json`))).size
      } catch {
        cacheBytes = 0
      }
    }
    rows.push({
      id,
      cwd,
      createdAt: snapshot?.header?.createdAt,
      logBytes: snapshot?.sizeBytes,
      dir: dir ?? null,
      sizeBytes: measured.sizeBytes,
      fileCount: measured.fileCount,
      cacheBytes,
      exists: dir !== undefined,
      known: snapshot !== undefined,
      live: liveness(ctx, id),
      childIds: childrenOf.get(id) ?? [],
      workspaces: registryWorkspaces
        .filter((workspace) => workspace.sessionIds.includes(id))
        .map((workspace) => ({ id: workspace.id, title: workspace.title, path: workspace.path })),
    })
  }
  return {
    home,
    sessionsRoot,
    projCacheDir,
    archivedIds,
    // Every Session the Host's persistence currently knows. The client compares
    // this with its own cached list to spot rows whose Session no longer exists
    // (its list is event-driven and has no removal of its own).
    persistedIds,
    archivedCount: archivedIds.length,
    resolvedCount: rows.filter((row) => row.exists).length,
    missingCount: rows.filter((row) => !row.exists).length,
    totalBytes,
    rows,
    listingError,
    pinnedIds: [...registry.pinnedSessionIds].filter((id) => archivedSet.has(id)),
  }
}

/**
 * Erase one archived session: its log directory, its projection cache, and its
 * registry bookkeeping. Every refusal happens before the first write.
 * @param ctx - the plugin context.
 * @param id - the archived session to erase.
 * @param dirs - the pre-scanned session-directory map.
 * @returns a per-session outcome.
 */
async function eraseSession(ctx, id, dirs) {
  const registry = ctx.workspaceRegistry
  if (!registry.archivedSessionIds.includes(id)) {
    return { id, status: 'skipped', reason: 'not-archived' }
  }
  const live = liveness(ctx, id)
  if (live.agent) {
    return { id, status: 'refused', reason: 'live', live }
  }
  const activity = await activityOf(ctx, id)
  if (activity.length > 0) {
    return { id, status: 'refused', reason: 'active', activity }
  }
  const { sessionsRoot, projCacheDir } = paths()
  let dir
  try {
    dir = dirs.get(encodeSegment(id))
  } catch {
    dir = undefined
  }
  // A session directory is only ever removed when its own name is the encoded
  // session id and it sits under the configured persistence root.
  if (dir !== undefined && !isInside(sessionsRoot, dir)) {
    return { id, status: 'failed', reason: 'outside-root', dir }
  }
  const removed = { dir: null, sizeBytes: 0, fileCount: 0, cache: false, cacheBytes: 0 }
  if (dir !== undefined) {
    const measured = await measureDir(dir)
    await fs.rm(dir, { recursive: true, force: true })
    removed.dir = dir
    removed.sizeBytes = measured.sizeBytes
    removed.fileCount = measured.fileCount
  }
  if (SAFE_FILE_ID.test(id)) {
    const cacheFile = join(projCacheDir, `${id}.json`)
    try {
      const info = await fs.stat(cacheFile)
      await fs.rm(cacheFile, { force: true })
      removed.cache = true
      removed.cacheBytes = info.size
    } catch {
      removed.cache = false
    }
  }
  // The client's Session list is fed by Host events and has no removal path of
  // its own, so a Session that disappears from disk behind its back keeps a
  // clickable ghost row. Announce the removal through the event the session
  // controller already defines for exactly this fact
  // (`api-session/removed`, declared `@mode emit`), before the registry writes
  // below drop the id from the archive set — otherwise the row would be
  // un-hidden for a moment and then vanish again. The client answers the event
  // with a `remove` mutation on its own list.
  try {
    ctx.emit('api-session/removed', id)
  } catch (error) {
    // Announcing is best-effort: the erase already happened, so a failure here
    // must never turn a successful deletion into a reported failure.
    ctx.logger?.warn?.(`archive-purge: could not announce the removal of '${id}': ${String(error)}`)
  }
  await registry.unarchiveSession(id)
  await registry.unpinSession(id)
  return { id, status: 'deleted', ...removed }
}

/**
 * Mount the archive-purge routes.
 * @param ctx - the plugin context carrying `webServer`, `workspaceRegistry`, and `sessionPersistence`.
 */
export function apply(ctx) {
  const log = ctx.logger ?? console

  /**
   * Serve one request, mapping thrown errors to a JSON 500.
   * @param req - the incoming request.
   * @param res - the response to own.
   * @param handler - the operation to run.
   */
  const route = (handler) => async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      log.warn?.(`archive-purge: ${String(error)}`)
      if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      else res.destroy()
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE}/inventory`,
    handler: route(async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' })
        res.end()
        return
      }
      sendJson(res, 200, await inventory(ctx), req.method === 'HEAD')
    }),
  }), 'archive-purge: inventory route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE}/delete`,
    handler: route(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' })
        res.end()
        return
      }
      const body = await readJsonBody(req)
      const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string') : []
      if (ids.length === 0) {
        sendJson(res, 400, { error: 'no session ids supplied' })
        return
      }
      const dirs = await scanSessionDirs(paths().sessionsRoot)
      const results = []
      for (const id of ids) {
        try {
          results.push(await eraseSession(ctx, id, dirs))
        } catch (error) {
          results.push({ id, status: 'failed', reason: error instanceof Error ? error.message : String(error) })
        }
      }
      sendJson(res, 200, { results })
    }),
  }), 'archive-purge: delete route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE}/unarchive`,
    handler: route(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' })
        res.end()
        return
      }
      const body = await readJsonBody(req)
      const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string') : []
      if (ids.length === 0) {
        sendJson(res, 400, { error: 'no session ids supplied' })
        return
      }
      const results = []
      for (const id of ids) {
        try {
          await ctx.workspaceRegistry.unarchiveSession(id)
          results.push({ id, status: 'restored' })
        } catch (error) {
          results.push({ id, status: 'failed', reason: error instanceof Error ? error.message : String(error) })
        }
      }
      sendJson(res, 200, { results })
    }),
  }), 'archive-purge: unarchive route')
}
