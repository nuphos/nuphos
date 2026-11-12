import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ACCOUNT_LABEL_MAX, accountLabel, shortAccount, withAccountLabels } from './accountLabel.ts'

import type { AgentCliStatus, LocalAgentInstance, LocalRuntimeState } from '../api/device-types.ts'
import type { LocalRuntimeSummary, RuntimeInstance } from '../types/runtime.ts'

const cli = (account?: string): AgentCliStatus => ({
  installed: true,
  path: '/usr/local/bin/agent',
  loggedIn: true,
  ...(account ? { account } : {}),
})

const installed = (account?: string) => ({ available: true, online: true, cli: cli(account) })

function state(over: Partial<LocalRuntimeState> = {}): LocalRuntimeState {
  return {
    agents: {
      'claude-code': installed('first@example.com'),
      codex: installed(),
      grok: { available: false, online: false, cli: null },
      opencode: { available: false, online: false, cli: null },
    },
    userId: 'u1',
    deviceId: 'mac',
    workspace: null,
    ...over,
  }
}

const onThisComputer = (over: Partial<LocalRuntimeSummary> = {}): LocalRuntimeSummary => ({
  ownerUserId: 'u1',
  deviceId: 'mac',
  deviceLabel: 'MacBook',
  signedIn: true,
  ...over,
})

/** This computer's default agent, as the catalog lists it. */
function mine(over: Partial<RuntimeInstance> = {}): RuntimeInstance {
  return {
    id: 'local_u1_mac',
    provider: 'claude-code',
    label: 'MacBook · Claude Code',
    status: 'active',
    kind: 'local',
    createdAt: '',
    local: onThisComputer(),
    ...over,
  }
}

/** One more Claude Code agent on this computer, listed under the id its host gave it. */
const added = (instanceId: string): RuntimeInstance =>
  mine({ id: `local_u1_mac_${instanceId}`, local: onThisComputer({ instanceId }) })

/** One more Claude Code agent as its host reports it, signed in to `account`. */
const hostInstance = (account?: string): LocalAgentInstance => ({
  instanceId: 'i-2',
  provider: 'claude-code',
  label: 'Claude Code 2',
  available: true,
  online: true,
  workspace: null,
  cli: cli(account),
})

test('a computer on two accounts labels its agents by account, not by number', () => {
  const [first, second] = withAccountLabels(
    [mine(), added('i-2')],
    state({ instances: [hostInstance('second@example.com')] }),
  )

  assert.equal(first?.local?.accountLabel, 'Claude Code · first@example.com')
  assert.equal(second?.local?.accountLabel, 'Claude Code · second@example.com')
  // The name each is stored under, which Rename edits, is left alone.
  assert.equal(second?.local?.agentLabel, undefined)
})

test('one account tells nothing apart, so the names stay as they were', () => {
  const instances = [mine(), added('i-2')]
  const labelled = withAccountLabels(
    instances,
    state({ instances: [hostInstance('FIRST@example.com')] }),
  )

  assert.deepEqual(labelled, instances)
  assert.equal(labelled[1], instances[1], 'an agent with nothing to add is not rebuilt')
})

test('an account the host has not reported leaves every name as it was', () => {
  const on = state({
    agents: {
      ...state().agents,
      'claude-code': installed(),
    },
    instances: [hostInstance('second@example.com')],
  })

  assert.deepEqual(
    withAccountLabels([mine(), added('i-2')], on).map((one) => one.local?.accountLabel),
    [undefined, undefined],
  )
})

test('a teammate’s computer, another of the viewer’s, and the team’s cloud agent are never labelled', () => {
  const mate = mine({
    id: 'local_u2_studio',
    local: onThisComputer({ ownerUserId: 'u2', deviceId: 'studio', deviceLabel: 'Studio' }),
  })
  const studio = mine({
    id: 'local_u1_studio',
    local: onThisComputer({ deviceId: 'studio', deviceLabel: 'Studio' }),
  })
  const cloud: RuntimeInstance = {
    id: 'rt-1',
    provider: 'claude-code',
    label: 'Team Claude',
    status: 'active',
    kind: 'managed',
    createdAt: '',
  }

  assert.deepEqual(
    withAccountLabels([mate, studio, cloud], state({ instances: [hostInstance()] })).map(
      (one) => one.local?.accountLabel,
    ),
    [undefined, undefined, undefined],
  )
})

test('an account is shown as one short line', () => {
  assert.equal(shortAccount('  sam.\n  long@example.com  '), 'sam. long@example.com')
  assert.equal(shortAccount('   '), undefined)
  const shown = shortAccount(`${'a'.repeat(60)}@example.com`)

  assert.equal(shown?.length, ACCOUNT_LABEL_MAX)
  assert.equal(shown, `${'a'.repeat(ACCOUNT_LABEL_MAX - 1)}…`)
})

test('an account only ever counts for the provider it belongs to', () => {
  const claude = { provider: 'claude-code' as const, account: 'first@example.com' }
  const codex = { provider: 'codex' as const, account: 'second@example.com' }

  assert.equal(accountLabel(claude, [claude, codex]), undefined)
  assert.equal(
    accountLabel(claude, [claude, codex, { ...claude, account: 'third@example.com' }]),
    'Claude Code · first@example.com',
  )
})

test('older payloads without the added agents behave exactly as before', () => {
  const instances = [mine(), added('i-2')]

  assert.deepEqual(withAccountLabels(instances, state()), instances)
  assert.deepEqual(withAccountLabels(instances, null), instances)
})
