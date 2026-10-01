import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { bundleStamp, bundleState, digestOf } from './bundle-stamp.mjs'

const ENTRY = 'node_modules/adapter/index.js'

function staged(manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'))

  writeFileSync(join(dir, 'openab'), '')
  mkdirSync(join(dir, 'adapters', 'codex', 'node_modules', 'adapter'), { recursive: true })
  writeFileSync(join(dir, 'adapters', 'codex', ENTRY), '')
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ openab: 'openab', adapters: { codex: { entry: ENTRY } }, ...manifest }),
  )

  return dir
}

test('a bundle stamped by this prepare.mjs is ready', () => {
  assert.equal(bundleState(staged({ stamp: 'abc' }), 'abc'), 'ready')
})

test('a bundle stamped by another prepare.mjs, or never stamped, is stale', () => {
  assert.equal(bundleState(staged({ stamp: 'old' }), 'new'), 'stale')
  assert.equal(bundleState(staged({}), 'new'), 'stale')
})

test('no manifest, no openab or a missing adapter entry is missing', () => {
  assert.equal(bundleState(mkdtempSync(join(tmpdir(), 'bundle-')), 'abc'), 'missing')
  assert.equal(bundleState(staged({ stamp: 'abc', openab: null }), 'abc'), 'missing')
  assert.equal(
    bundleState(staged({ stamp: 'abc', adapters: { codex: { entry: 'gone.js' } } }), 'abc'),
    'missing',
  )
})

test('the stamp follows the pins and patches in the staging sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stamp-'))

  for (const file of ['prepare.mjs', 'adapter-patches.mjs', 'skills-sync.mjs'])
    writeFileSync(join(dir, file), `// ${file}`)
  const before = bundleStamp(dir)

  assert.equal(bundleStamp(dir), before)
  writeFileSync(join(dir, 'prepare.mjs'), "export const OPENAB_COMMIT = 'next'")
  assert.notEqual(bundleStamp(dir), before)
  assert.notEqual(digestOf(['adapter-patches.mjs'], dir), digestOf(['skills-sync.mjs'], dir))
})
