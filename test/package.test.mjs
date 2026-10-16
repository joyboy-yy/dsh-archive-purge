/**
 * Release-integrity tests.
 *
 * Everything DSH needs at runtime is named by the manifest: the entry point,
 * the `./client` export, and the bundle patch. npm only ships what `files`
 * lists. If those two disagree, the package installs cleanly and then fails to
 * load — the one failure mode a marketplace listing cannot survive, and one
 * that no unit test of the halves can see.
 *
 * Run with `npm test` (node --test, no dependencies).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pkgPath = require.resolve('../package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const root = dirname(pkgPath)

/** Strip the leading `./` npm export targets carry. */
const normalize = (relative) => relative.replace(/^\.\//, '')

/** Every file the manifest points at, so every one of them has to ship. */
const runtimeFiles = [
  normalize(pkg.main),
  normalize(pkg.dsh.bundle.patch),
  ...Object.values(pkg.exports).map(normalize),
  'LICENSE',
  'README.md',
]

test('every file the manifest points at exists', () => {
  for (const relative of runtimeFiles) {
    assert.ok(existsSync(join(root, relative)), `${relative} must exist`)
  }
})

test('every file the manifest points at is listed in "files"', () => {
  const listed = new Set(pkg.files.map(normalize))
  // npm publishes package.json, README and LICENSE whatever `files` says, so
  // only the files it would otherwise drop have to be listed explicitly.
  const alwaysShipped = new Set(['package.json', 'README.md', 'LICENSE'])
  for (const relative of new Set(runtimeFiles)) {
    if (alwaysShipped.has(relative)) continue
    assert.ok(listed.has(relative), `${relative} is required at runtime but missing from "files"`)
  }
})

test('the bundle patch is non-empty and names this package', () => {
  const patch = pkg.dsh?.bundle?.patch
  assert.equal(typeof patch, 'string')
  assert.ok(patch.trim().length > 0, 'a bundle without a patch is not installable')
  const text = readFileSync(join(root, normalize(patch)), 'utf8')
  assert.match(text, /^-\s*insert:/m, 'the patch must insert a composition row')
  assert.match(text, new RegExp(`^\\s*name:\\s*${pkg.name}\\s*$`, 'm'),
    'the row name is what DSH resolves from the profile node_modules')
})

test('the client half is exported and registers under the package name', () => {
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  assert.match(source, new RegExp(`id: '${pkg.name}'`),
    'the module id must be the package name DSH loads it by')
})

test('nothing that only matters in the repository is published', () => {
  for (const devOnly of ['test/', 'docs/', '.github/', '.gitignore', '.gitattributes']) {
    assert.ok(!pkg.files.map(normalize).includes(devOnly.replace(/\/$/, '')), `${devOnly} must not ship`)
  }
  assert.equal(pkg.private, undefined, 'a private package cannot be published')
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.repository.url, 'git+https://github.com/joyboy-yy/dsh-archive-purge.git')
  assert.equal(pkg.repository.directory, undefined)
})

test('no install lifecycle script can demand a build approval', () => {
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublishOnly']
  const found = lifecycle.filter((name) => name in (pkg.scripts ?? {}))
  assert.deepEqual(found, [], `a marketplace install would stop for: ${found.join(', ')}`)
})

test('the shipped sources are plain ESM with no runtime dependency', () => {
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.peerDependencies, undefined)
  for (const relative of [normalize(pkg.main), 'client.js']) {
    const source = readFileSync(join(root, relative), 'utf8')
    assert.match(source, /^(?:import|export|\/\*|window\.|const|let|function|'|")/m)
    const bareImports = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'".][^'"]*)['"]/gm)]
      .map((match) => match[1])
      .filter((specifier) => !specifier.startsWith('node:'))
    assert.deepEqual(bareImports, [], `${relative} would need a dependency: ${bareImports.join(', ')}`)
    assert.ok(statSync(join(root, relative)).size > 0)
  }
})
