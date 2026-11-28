import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pickLocalStarter, withTimeout } from './starterSelection.ts'

import type { RuntimeInstance } from '../../../types/runtime.ts'

const HERE = 'device-here'

function runtime(
  provider: string,
  local: Partial<NonNullable<RuntimeInstance['local']>> = {},
): RuntimeInstance {
  return {
    id: `${provider}@${local.deviceId ?? HERE}`,
    provider,
    label: provider,
    status: 'active',
    kind: 'local',
    createdAt: '2026-01-01T00:00:00.000Z',
    local: { deviceId: HERE, online: true, signedIn: true, ...local },
  } as RuntimeInstance
}

const pick = (...runtimes: RuntimeInstance[]) => pickLocalStarter(runtimes, HERE)?.agentRuntime

test('Claude Code on this computer wins over Codex and Grok Build', () => {
  assert.equal(pick(runtime('grok'), runtime('codex'), runtime('claude-code')), 'claude-code')
})

test('only Codex, then only Grok Build, start the Bot here', () => {
  assert.equal(pick(runtime('codex'), runtime('opencode')), 'codex')
  assert.equal(pick(runtime('grok'), runtime('pi')), 'grok')
})

test('with none of them usable here, the Bot goes to the Box', () => {
  assert.equal(pick(), undefined)
  assert.equal(pick(runtime('opencode'), runtime('hermes')), undefined)
  assert.equal(pick(runtime('claude-code', { deviceId: 'box-1' })), undefined)
})

test('signed out, offline or failing its probe does not count as usable', () => {
  assert.equal(pick(runtime('claude-code', { signedIn: false }), runtime('codex')), 'codex')
  assert.equal(pick(runtime('claude-code', { online: false })), undefined)
  assert.equal(pick(runtime('codex', { probeError: 'not found' })), undefined)
})

test('a signed-in state the computer cannot tell still counts', () => {
  assert.equal(pick(runtime('claude-code', { signedIn: null })), 'claude-code')
})

test('withTimeout rejects a call that takes too long and passes a quick one', async () => {
  assert.equal(await withTimeout(Promise.resolve(1), 50), 1)
  await assert.rejects(
    withTimeout(new Promise((resolve) => setTimeout(resolve, 200)), 10),
    /Timed out/,
  )
})
