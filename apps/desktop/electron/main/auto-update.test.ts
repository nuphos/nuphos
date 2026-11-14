import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUTO_INSTALL_IDLE_SECONDS,
  DEFAULT_AUTO_INSTALL,
  idleThreshold,
  parseAutoInstall,
  shouldAutoInstall,
} from './auto-update.ts'

import type { AutoInstallSignals } from './auto-update.ts'

const quiet: AutoInstallSignals = {
  enabled: true,
  ready: true,
  failedBefore: false,
  busy: false,
  idleSeconds: AUTO_INSTALL_IDLE_SECONDS,
}

test('off by default', () => {
  assert.deepEqual(DEFAULT_AUTO_INSTALL, { enabled: false })
})

test('restarts once a ready update meets an idle computer with no agent work', () => {
  assert.equal(shouldAutoInstall(quiet), true)
})

test('waits while anything says no', () => {
  assert.equal(shouldAutoInstall({ ...quiet, enabled: false }), false)
  assert.equal(shouldAutoInstall({ ...quiet, ready: false }), false)
  assert.equal(shouldAutoInstall({ ...quiet, busy: true }), false)
  assert.equal(shouldAutoInstall({ ...quiet, idleSeconds: AUTO_INSTALL_IDLE_SECONDS - 1 }), false)
})

test('does not retry an update whose last restart came back on the old version', () => {
  assert.equal(shouldAutoInstall({ ...quiet, failedBefore: true }), false)
})

test('only a boolean preference is accepted', () => {
  assert.deepEqual(parseAutoInstall({ enabled: true }), { enabled: true })
  for (const value of [null, {}, { enabled: 'yes' }, 'true'])
    assert.throws(() => parseAutoInstall(value), /Invalid/u)
})

test('the idle wait can be shortened for testing, but not below 30 seconds', () => {
  assert.equal(idleThreshold({}), AUTO_INSTALL_IDLE_SECONDS)
  assert.equal(idleThreshold({ NUPHOS_AUTO_UPDATE_IDLE_SECONDS: '45' }), 45)
  assert.equal(idleThreshold({ NUPHOS_AUTO_UPDATE_IDLE_SECONDS: '5' }), 30)
  assert.equal(
    idleThreshold({ NUPHOS_AUTO_UPDATE_IDLE_SECONDS: 'soon' }),
    AUTO_INSTALL_IDLE_SECONDS,
  )
})
