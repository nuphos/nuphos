import assert from 'node:assert/strict'
import test from 'node:test'

import { hostUpdateVersion, runtimeUpdatePresentation } from './runtimeUpdatePresentation.ts'

const base = {
  currentVersion: '0.1.2',
  latestVersion: '0.1.3',
  releaseUrl: 'https://github.com/zeabur/nuphos-runtime/releases/tag/v0.1.3',
}

test('only administrators of managed agents see an available update button', () => {
  const update = { ...base, state: 'available' as const }

  assert.equal(runtimeUpdatePresentation(update, true, true, true).showButton, true)
  assert.equal(runtimeUpdatePresentation(update, true, false, true).showButton, false)
  assert.match(runtimeUpdatePresentation(update, true, false, true).detail, /administrator/)
  assert.equal(runtimeUpdatePresentation(update, false, false, true).showButton, false)
  assert.match(runtimeUpdatePresentation(update, false, false, true).detail, /host/)
})
test('queued and rolling updates disable repeated requests and describe the actual state', () => {
  assert.equal(
    runtimeUpdatePresentation({ ...base, state: 'waiting' }, true, true, true).pending,
    true,
  )
  assert.match(
    runtimeUpdatePresentation({ ...base, state: 'waiting' }, true, true, false).detail,
    /Enable/,
  )
  assert.equal(
    runtimeUpdatePresentation({ ...base, state: 'updating' }, true, true, true).button,
    'Updating…',
  )
  assert.equal(
    runtimeUpdatePresentation({ ...base, state: 'failed' }, true, true, true).button,
    'Retry update',
  )
  assert.equal(
    runtimeUpdatePresentation({ ...base, state: 'unknown' }, true, true, true).showButton,
    false,
  )
})

test('a host back on the latest version clears the update an earlier read offered', () => {
  assert.equal(hostUpdateVersion({ state: 'available', latestVersion: '0.8.3' }), '0.8.3')
  assert.equal(hostUpdateVersion({ state: 'failed', latestVersion: '0.8.3' }), '0.8.3')
  assert.equal(hostUpdateVersion({ state: 'available' }), '')
  // After the update the host reports 0.8.3 and the backend answers current.
  assert.equal(hostUpdateVersion({ state: 'current', latestVersion: '0.8.3' }), undefined)
  assert.equal(hostUpdateVersion({ state: 'unknown' }), undefined)
  assert.equal(hostUpdateVersion(undefined), undefined)
})
