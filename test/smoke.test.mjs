/**
 * Smoke tests for dsh-archive-purge.
 *
 * Neither half is a pure function, but both expose one entry point that can be
 * driven with a stub context, and the two halves must agree on identifiers that
 * nothing else checks: the module id the client registers under, the route
 * prefix the host mounts and the client calls, and the slot keys the panel
 * occupies. A rename that misses one side leaves a plugin that loads silently
 * and then does nothing — the failure these tests exist to catch.
 *
 * Run with `npm test` (node --test, no dependencies).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')
const HOST_SRC = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const CLIENT_SRC = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const host = await import(new URL('../index.js', import.meta.url).href)

/** The route prefix both halves must agree on. */
const ROUTE = '/api/archive-purge'

/**
 * A React stub wide enough to let the client factory define its components.
 * Nothing here renders, so the hooks only have to exist and be callable.
 * @returns a stand-in for the react module the loader would hand over.
 */
function reactStub() {
  const noop = () => {}
  return {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: Symbol('Fragment'),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, noop],
    useCallback: (fn) => fn,
    useEffect: noop,
    useMemo: (fn) => fn(),
    useRef: (initial) => ({ current: initial }),
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  }
}

/**
 * Execute client.js against browser stubs and return what it registered.
 * @param options - optional pre-seeded persisted view state.
 * @returns the captured loader config, appended styles and storage contents.
 */
function loadClientHalf({ persistedView } = {}) {
  const appended = []
  const storage = new Map()
  if (persistedView !== undefined) storage.set('dsh.workspace.view.v5', persistedView)

  let captured
  const styleEl = { dataset: {}, textContent: '', remove: () => {} }

  const sandbox = {
    console,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }),
    document: {
      createElement: () => styleEl,
      head: { appendChild: (el) => appended.push(el) },
    },
    window: {
      __ModuleLoader__: { load: (config) => { captured = config } },
      localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, value),
      },
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  }

  vm.runInNewContext(CLIENT_SRC, sandbox, { filename: 'client.js' })
  assert.ok(captured, 'client.js must call window.__ModuleLoader__.load')
  return { captured, appended, storage, styleEl }
}

/**
 * A context stub recording every registration the plugin makes.
 * @param options - `archivedSessionIds` seeds the workspaces service facade.
 * @returns the stub context plus the recorded calls.
 */
function stubContext({ archivedSessionIds = [] } = {}) {
  const routes = []
  const slots = []
  const effects = []
  const locales = []
  const workspacesSnapshot = { archivedSessionIds }
  const ctx = {
    logger: { warn: () => {}, info: () => {} },
    get: (name) => (name === 'workspaces'
      ? { list: { getSnapshot: () => workspacesSnapshot, subscribe: () => () => {} } }
      : undefined),
    effect: (fn, label) => { effects.push(label); return typeof fn === 'function' ? fn() : undefined },
    emit: () => {},
    on: () => {},
    waterfall: async () => [],
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    workspaceRegistry: {
      archivedSessionIds: [],
      pinnedSessionIds: [],
      list: () => [],
      unarchiveSession: async () => {},
      unpinSession: async () => {},
    },
    sessionPersistence: { list: async () => [] },
    slots: {
      inject: (name, fn) => { fn(); return () => {} },
      register: (config, component) => { slots.push({ config, component }); return () => {} },
    },
    locale: {
      register: (ns, dict) => { locales.push({ ns, dict }); return () => {} },
      bind: () => (key) => key,
      getSnapshot: () => ({}),
      subscribe: () => () => {},
    },
  }
  return { ctx, routes, slots, effects, locales }
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
 * @returns the response stub, with `sent` holding the bodies written.
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

test('host half declares the services it needs', () => {
  assert.deepEqual(host.inject, ['webServer', 'workspaceRegistry', 'sessionPersistence'])
  assert.equal(typeof host.apply, 'function')
})

test('host half mounts its three routes under the agreed prefix', () => {
  const { ctx, routes } = stubContext()
  host.apply(ctx)

  assert.deepEqual(
    routes.map((route) => `${route.kind} ${route.path}`).sort(),
    [`exact ${ROUTE}/delete`, `exact ${ROUTE}/inventory`, `exact ${ROUTE}/unarchive`].sort(),
  )
  for (const route of routes) assert.equal(typeof route.handler, 'function')
})

test('host half refuses a delete for a session that is not archived', async () => {
  const { ctx, routes } = stubContext()
  host.apply(ctx)
  const deleteRoute = routes.find((route) => route.path === `${ROUTE}/delete`)

  const res = responseStub()
  await deleteRoute.handler(requestStub('POST', { ids: ['not-archived'] }), res)

  const payload = JSON.parse(res.sent[0])
  assert.equal(payload.results.length, 1)
  assert.deepEqual(payload.results[0], { id: 'not-archived', status: 'skipped', reason: 'not-archived' })
})

test('host half rejects a delete with no ids and a wrong method', async () => {
  const { ctx, routes } = stubContext()
  host.apply(ctx)

  const deleteRoute = routes.find((route) => route.path === `${ROUTE}/delete`)
  const badMethod = responseStub()
  await deleteRoute.handler(requestStub('GET'), badMethod)
  assert.equal(badMethod.status, 405)

  const empty = responseStub()
  await deleteRoute.handler(requestStub('POST', { ids: [] }), empty)
  assert.equal(empty.status, 400)
  assert.match(JSON.parse(empty.sent[0]).error, /no session ids/)

  const inventoryRoute = routes.find((route) => route.path === `${ROUTE}/inventory`)
  const inventory = responseStub()
  await inventoryRoute.handler(requestStub('GET'), inventory)
  assert.equal(inventory.status, 200)
  const body = JSON.parse(inventory.sent[0])
  assert.equal(body.archivedCount, 0)
  assert.deepEqual(body.rows, [])
  assert.deepEqual(body.persistedIds, [])
})

test('client half registers under the published package name', () => {
  const { captured } = loadClientHalf()
  assert.equal(captured.id, pkg.name)
  assert.equal(typeof captured.factory, 'function')
})

test('client half needs only slots and locale', () => {
  const { captured } = loadClientHalf()
  const exports = captured.factory(() => reactStub())
  // Spread first: the factory runs in a vm realm, so its array would fail a
  // deepStrictEqual against one built here purely on prototype identity.
  assert.deepEqual([...exports.inject], ['slots', 'locale'])
  assert.equal(typeof exports.apply, 'function')
})

test('client half fills the panel slots and installs the hide rule', () => {
  const { captured, appended, styleEl } = loadClientHalf()
  const exports = captured.factory(() => reactStub())

  const { ctx, slots, effects, locales } = stubContext({ archivedSessionIds: ['sess-a', 'sess-b'] })
  exports.apply(ctx)

  const slotNames = slots.map((slot) => `${slot.config.name}:${slot.config.id ?? slot.config.key}`).sort()
  assert.deepEqual(slotNames, [
    'main:archive-purge',
    'shell.overlay:archive-purge.confirm',
    'shell.overlay:archive-purge.hide-archived',
    'sidebar.panellist:archive-purge',
  ].sort())

  assert.equal(locales.length, 1)
  assert.equal(locales[0].ns, 'archive-purge')
  for (const key of ['panel', 'title', 'delete', 'restore', 'confirmTitle', 'footerNote']) {
    assert.ok(locales[0].dict.zh[key], `zh dictionary must define ${key}`)
    assert.ok(locales[0].dict.en[key], `en dictionary must define ${key}`)
  }

  // A count of one must not fall back to the plural template in English. The
  // singular key is optional per locale, which is how Chinese reuses one string.
  for (const key of [
    'childCount', 'metaFiles', 'ghostsHidden', 'subtitle', 'confirmTitle',
    'confirmMissing', 'purged', 'restored', 'refusedActive',
  ]) {
    assert.ok(locales[0].dict.zh[`${key}One`], `zh dictionary must define ${key}One`)
    assert.ok(locales[0].dict.en[`${key}One`], `en dictionary must define ${key}One`)
    assert.notEqual(locales[0].dict.en[`${key}One`], locales[0].dict.en[key],
      `English must not describe a single item with the plural template (${key})`)
  }

  assert.equal(appended.length, 1, 'exactly one stylesheet is appended')
  assert.equal(appended[0], styleEl)
  assert.match(styleEl.textContent, /\[data-row-key="session:sess-a"\],\[data-row-key="session:sess-b"\]\{display:none!important\}/,
    'every archived id gets its own hide rule')
  assert.doesNotMatch(styleEl.textContent, /data-row-key="session:undefined"/)
  assert.match(styleEl.textContent, /aria-description/)
  assert.ok(effects.length >= 2, 'the stylesheet and the dictionary are both effects')
})

test('client half still installs the fallback hide rule with nothing archived', () => {
  const { captured, styleEl } = loadClientHalf()
  const exports = captured.factory(() => reactStub())
  exports.apply(stubContext().ctx)

  assert.doesNotMatch(styleEl.textContent, /\[data-row-key="session:[^"]*"\]\{display:none/)
  assert.match(styleEl.textContent, /aria-description="Archived sessions cannot be opened[^"]*"\]\{display:none!important\}/)
})

test('client half resets a persisted archived filter back to the shipped default', () => {
  const { captured, storage } = loadClientHalf({
    persistedView: JSON.stringify({ archivedFilter: 'all', sort: 'recent' }),
  })
  const exports = captured.factory(() => reactStub())
  exports.apply(stubContext().ctx)

  const stored = JSON.parse(storage.get('dsh.workspace.view.v5'))
  assert.equal(stored.archivedFilter, 'default', 'the filter is forced back to the default')
  assert.equal(stored.sort, 'recent', 'unrelated view state is preserved')
})

test('client half leaves an already-default filter untouched', () => {
  const original = JSON.stringify({ archivedFilter: 'default' })
  const { captured, storage } = loadClientHalf({ persistedView: original })
  const exports = captured.factory(() => reactStub())
  exports.apply(stubContext().ctx)
  assert.equal(storage.get('dsh.workspace.view.v5'), original)
})

test('both halves agree on the route prefix and the package name', () => {
  const hostPrefixes = new Set(HOST_SRC.match(/\/api\/[a-z0-9-]+/g) ?? [])
  const clientPrefixes = new Set(CLIENT_SRC.match(/\/api\/[a-z0-9-]+/g) ?? [])

  assert.deepEqual([...hostPrefixes], [ROUTE], 'host half must mount exactly one prefix')
  assert.deepEqual([...clientPrefixes], [ROUTE], 'client half must call exactly that prefix')
  assert.match(CLIENT_SRC, new RegExp(`id: '${pkg.name}'`), 'the client module id is the package name')
  assert.match(HOST_SRC, new RegExp(`ROUTE = '${ROUTE}'`), 'the host route constant is the agreed prefix')
})
