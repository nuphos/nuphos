import assert from 'node:assert/strict'
import test from 'node:test'

import { DATABASE_NAV_LABELS, isDatabaseEngineReleased } from './databaseRelease.ts'

test('the release UI exposes MongoDB only', () => {
  assert.equal(isDatabaseEngineReleased('mongodb'), true)
  assert.equal(isDatabaseEngineReleased('postgresql'), false)
  assert.equal(isDatabaseEngineReleased('mysql'), false)
  assert.equal(isDatabaseEngineReleased('cloudflare-d1'), false)
})

test('unfinished capability previews stay out of the release navigation', () => {
  const labels = Object.values(DATABASE_NAV_LABELS)

  assert.equal(labels.includes('Backup / Restore'), false)
  assert.equal(labels.includes('Parameters'), false)
})

test('every sidebar nav key carries a label', () => {
  for (const [key, label] of Object.entries(DATABASE_NAV_LABELS)) {
    assert.ok(key.startsWith('database.'), `${key} should be a database nav key`)
    assert.ok(label.length > 0, `${key} needs a label`)
  }
})
