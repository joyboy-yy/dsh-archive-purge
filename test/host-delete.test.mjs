/**
 * Destructive-path tests for dsh-archive-purge's host half.
 *
 * `smoke.test.mjs` covers the identifiers a rename breaks. This file covers the
 * thing a user actually risks: the erase. It runs the real routes against a
 * throwaway `DSH_HOME` on disk, so the log directory and the projection-cache
 * record are genuinely created and genuinely removed, and every refusal is
 * exercised on the branch that decides it.
 *
 * Run with `npm test` (node --test, no dependencies).
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const ROUTE = '/api/archive-purge'

/** Set for the duration of one test; the host resolves it on every call. */
let home
let previousHome
let host

beforeEach(async () => {
  home = join(tmpdir(), `dsh-archive-purge-${randomBytes(6).toString('hex')}`)
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  host = await import(new URL('../index.js', import.meta.url).href)
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})

/**
 * Lay down a session log directory and its projection-cache record.
 * @param id - the session id; also used verbatim as the directory name.
 * @param options - `project` names the per-project directory, `logBytes` sizes the log.
 * @returns the created session directory and cache file paths.
 */
async function seedSession(id, { project = 'project-a', logBytes = 64 } = {}) {
  const dir = join(home, 'sessions', project, id)
  const cache = join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`)
  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  await fs.writeFile(join(dir, 'session.jsonl'), 'x'.repeat(logBytes))
  await fs.writeFile(cache, JSON.stringify({ id, checkpoint: 1 }))
  return { dir, cache }
}

/**
 * A context stub whose registry reports one archived session.
 * @param options - archived ids, live agents, and reported activity.
 * @returns the context plus the calls it recorded.
 */
function stubContext({ archivedSessionIds = [], pinnedSessionIds = [], agents = [], activity = [] } = {}) {
  const emitted = []
  const calls = { unarchived: [], unpinned: [] }
  const routes = []
  /**
   * Every mutating step in the order it happened. The host documents that it
   * announces the removal *before* rewriting the archive bookkeeping, because
   * the other order briefly un-hides a row that is about to vanish.
   */
  const timeline = []
  const agentMap = new Map(agents.map((id) => [id, { id, status: 'idle' }]))
  const ctx = {
    logger: { warn: () => {}, info: () => {} },
    get: (name) => {
      if (name === 'agents') return agentMap
      if (name === 'sessions') return new Map()
      return undefined
    },
    effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
    emit: (event, id) => { emitted.push({ event, id }); timeline.push(`emit:${id}`) },
    waterfall: async () => activity,
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    workspaceRegistry: {
      archivedSessionIds,
      pinnedSessionIds,
      list: () => [],
      unarchiveSession: async (id) => { calls.unarchived.push(id); timeline.push(`unarchive:${id}`) },
      unpinSession: async (id) => { calls.unpinned.push(id); timeline.push(`unpin:${id}`) },
    },
    sessionPersistence: {
      list: async () => archivedSessionIds.map((id) => ({
        header: { id, cwd: 'C:\\work', createdAt: '2026-01-01T00:00:00.000Z' },
        sizeBytes: 64,
      })),
    },
  }
  host.apply(ctx)
  return { ctx, routes, emitted, calls, timeline }
}

/**
 * Build a request whose body is the given JSON.
 * @param method - HTTP method.
 * @param body - value to serialize, or undefined for an empty body.
 * @returns the request stub.
 */
function requestStub(method, body) {
  return {
    method,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
}

/**
 * Build a response stub that records what was written.
 * @returns the response stub.
 */
function responseStub() {
  const sent = []
  return {
    sent,
    headersSent: false,
    writeHead(status) { this.status = status },
    end(body) { sent.push(body) },
    destroy() {},
  }
}

/**
 * Call one route and parse its JSON response.
 * @param routes - the routes the host registered.
 * @param path - the route path to call.
 * @param method - HTTP method.
 * @param body - optional JSON body.
 * @returns the parsed response body.
 */
async function call(routes, path, method, body) {
  const route = routes.find((r) => r.path === path)
  assert.ok(route, `route ${path} must be registered`)
  const res = responseStub()
  await route.handler(requestStub(method, body), res)
  return { status: res.status, body: res.sent.length > 0 ? JSON.parse(res.sent[0]) : undefined }
}

test('inventory reports disk truth for an archived session', async () => {
  const { dir, cache } = await seedSession('sess-inv', { logBytes: 128 })
  const { routes } = stubContext({ archivedSessionIds: ['sess-inv'] })

  const { status, body } = await call(routes, `${ROUTE}/inventory`, 'GET')

  assert.equal(status, 200)
  assert.equal(body.archivedCount, 1)
  assert.equal(body.resolvedCount, 1)
  assert.equal(body.missingCount, 0)
  assert.deepEqual(body.persistedIds, ['sess-inv'])

  const row = body.rows[0]
  assert.equal(row.id, 'sess-inv')
  assert.equal(row.exists, true)
  assert.equal(row.known, true)
  assert.equal(row.dir, dir)
  assert.equal(row.sizeBytes, 128, 'the log directory is measured')
  assert.equal(row.fileCount, 1)
  assert.equal(row.cacheBytes, (await fs.stat(cache)).size, 'the cache record is measured')
  assert.deepEqual(row.live, { attached: false, agent: false, running: false })
})

test('inventory reports an archived id whose log is already gone', async () => {
  const { routes } = stubContext({ archivedSessionIds: ['sess-ghost'] })
  const { body } = await call(routes, `${ROUTE}/inventory`, 'GET')

  assert.equal(body.archivedCount, 1)
  assert.equal(body.resolvedCount, 0)
  assert.equal(body.missingCount, 1)
  assert.equal(body.rows[0].exists, false)
  assert.equal(body.rows[0].known, true, 'the persistence layer still knows it')
})

test('delete removes the log directory, the cache record and the bookkeeping', async () => {
  const { dir, cache } = await seedSession('sess-del', { logBytes: 256 })
  const { routes, emitted, calls, timeline } = stubContext({ archivedSessionIds: ['sess-del'], pinnedSessionIds: ['sess-del'] })

  const { body } = await call(routes, `${ROUTE}/delete`, 'POST', { ids: ['sess-del'] })

  assert.equal(body.results.length, 1)
  const result = body.results[0]
  assert.equal(result.status, 'deleted')
  assert.equal(result.dir, dir)
  assert.equal(result.sizeBytes, 256)
  assert.equal(result.fileCount, 1)
  assert.equal(result.cache, true)
  assert.ok(result.cacheBytes > 0)

  await assert.rejects(fs.stat(dir), 'the log directory is gone')
  await assert.rejects(fs.stat(cache), 'the projection-cache record is gone')

  assert.deepEqual(calls.unarchived, ['sess-del'], 'the archive record is cleared')
  assert.deepEqual(calls.unpinned, ['sess-del'], 'the pin record is cleared')
  assert.deepEqual(emitted, [{ event: 'api-session/removed', id: 'sess-del' }],
    'the client is told to drop the row')
  assert.deepEqual(timeline, ['emit:sess-del', 'unarchive:sess-del', 'unpin:sess-del'],
    'the removal is announced before the archive set is rewritten')
})

test('delete clears the record of an archived session whose log is already gone', async () => {
  const { routes, emitted, calls } = stubContext({ archivedSessionIds: ['sess-gone'] })

  const { body } = await call(routes, `${ROUTE}/delete`, 'POST', { ids: ['sess-gone'] })

  assert.equal(body.results[0].status, 'deleted')
  assert.equal(body.results[0].dir, null)
  assert.equal(body.results[0].sizeBytes, 0)
  assert.deepEqual(calls.unarchived, ['sess-gone'])
  assert.deepEqual(emitted, [{ event: 'api-session/removed', id: 'sess-gone' }])
})

test('delete refuses a session an agent still holds, and touches nothing', async () => {
  const { dir, cache } = await seedSession('sess-live')
  const { routes, emitted, calls } = stubContext({ archivedSessionIds: ['sess-live'], agents: ['sess-live'] })

  const { body } = await call(routes, `${ROUTE}/delete`, 'POST', { ids: ['sess-live'] })

  assert.equal(body.results[0].status, 'refused')
  assert.equal(body.results[0].reason, 'live')
  assert.deepEqual(body.results[0].live, { attached: false, agent: true, running: false })

  await fs.stat(dir)
  await fs.stat(cache)
  assert.deepEqual(calls.unarchived, [], 'the archive record must survive a refusal')
  assert.deepEqual(emitted, [], 'no removal may be announced for a refusal')
})

test('delete refuses a session with work still in flight, and touches nothing', async () => {
  const { dir, cache } = await seedSession('sess-busy')
  const { routes, emitted, calls } = stubContext({
    archivedSessionIds: ['sess-busy'],
    activity: [{ kind: 'turn', label: 'running' }],
  })

  const { body } = await call(routes, `${ROUTE}/delete`, 'POST', { ids: ['sess-busy'] })

  assert.equal(body.results[0].status, 'refused')
  assert.equal(body.results[0].reason, 'active')
  assert.equal(body.results[0].activity.length, 1)

  await fs.stat(dir)
  await fs.stat(cache)
  assert.deepEqual(calls.unarchived, [])
  assert.deepEqual(emitted, [])
})

test('delete processes a mixed batch and reports each outcome', async () => {
  await seedSession('keep-1')
  await seedSession('keep-2')
  await seedSession('drop-1')
  const { routes, calls } = stubContext({
    archivedSessionIds: ['keep-1', 'drop-1'],
    agents: ['keep-1'],
  })

  const { body } = await call(routes, `${ROUTE}/delete`, 'POST', {
    ids: ['keep-1', 'drop-1', 'not-archived'],
  })

  const byId = new Map(body.results.map((r) => [r.id, r]))
  assert.equal(byId.get('keep-1').reason, 'live')
  assert.equal(byId.get('drop-1').status, 'deleted')
  assert.equal(byId.get('not-archived').reason, 'not-archived')

  await fs.stat(join(home, 'sessions', 'project-a', 'keep-1'))
  await fs.stat(join(home, 'sessions', 'project-a', 'keep-2'))
  await assert.rejects(fs.stat(join(home, 'sessions', 'project-a', 'drop-1')))
  assert.deepEqual(calls.unarchived, ['drop-1'], 'only the deleted session is unarchived')
})

test('unarchive restores a session without touching the disk', async () => {
  const { dir } = await seedSession('sess-un')
  const { routes, calls } = stubContext({ archivedSessionIds: ['sess-un'] })

  const { body } = await call(routes, `${ROUTE}/unarchive`, 'POST', { ids: ['sess-un'] })

  assert.deepEqual(body.results, [{ id: 'sess-un', status: 'restored' }])
  assert.deepEqual(calls.unarchived, ['sess-un'])
  await fs.stat(dir)
})

test('inventory ignores directories that hold no session log', async () => {
  await fs.mkdir(join(home, 'sessions', 'project-a', 'empty-dir'), { recursive: true })
  await fs.mkdir(join(home, 'sessions', 'project-a', 'other'), { recursive: true })
  await fs.writeFile(join(home, 'sessions', 'project-a', 'other', 'notes.txt'), 'not a log')
  const { routes } = stubContext({ archivedSessionIds: ['empty-dir', 'other'] })

  const { body } = await call(routes, `${ROUTE}/inventory`, 'GET')

  assert.equal(body.resolvedCount, 0)
  assert.equal(body.missingCount, 2)
  for (const row of body.rows) assert.equal(row.exists, false)
})

test('delete removes exactly the archived session directory and leaves its siblings', async () => {
  const drop = await seedSession('sess-target')
  const keep = await seedSession('sess-sibling')
  const { routes } = stubContext({ archivedSessionIds: ['sess-target'] })

  const { body } = await call(routes, `${ROUTE}/delete`, 'POST', { ids: ['sess-target'] })

  assert.equal(body.results[0].status, 'deleted')
  assert.equal(body.results[0].dir, drop.dir)
  await assert.rejects(fs.stat(drop.dir), 'the targeted directory is gone')
  await fs.stat(join(keep.dir, 'session.jsonl'))
  await fs.stat(keep.cache)
})

test('an id that cannot name a file only has its bookkeeping cleared', async () => {
  const keep = await seedSession('sess-safe')
  const { routes, calls } = stubContext({ archivedSessionIds: ['../escape', 'sess-safe'] })

  const { body } = await call(routes, `${ROUTE}/delete`, 'POST', { ids: ['../escape'] })

  assert.equal(body.results[0].status, 'deleted')
  assert.equal(body.results[0].dir, null, 'no directory is ever resolved for such an id')
  assert.equal(body.results[0].cache, false, 'and no cache file is touched either')
  assert.deepEqual(calls.unarchived, ['../escape'])
  await fs.stat(join(keep.dir, 'session.jsonl'))
})
