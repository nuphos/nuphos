import assert from 'node:assert/strict'
import test from 'node:test'
import { upgradeVersion } from '../scripts/update-claude-sdk.mjs'

test('only newer stable SDK versions within the current major are automatic', () => {
  assert.equal(upgradeVersion('0.3.261', '0.3.284'), true)
  assert.equal(upgradeVersion('0.3.284', '0.4.0'), true)
  assert.equal(upgradeVersion('0.3.284', '0.3.284'), false)
  assert.equal(upgradeVersion('0.3.284', '0.3.280'), false)
  assert.throws(() => upgradeVersion('0.3.284', '1.0.0'), /manual review/)
  assert.throws(() => upgradeVersion('0.3.284', '0.3.285-beta.1'), /stable version/)
})
