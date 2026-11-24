import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  agentDisplayName,
  agentName,
  agentOffline,
  agentRunsOn,
  localRemovalId,
  localSignIn,
  managesRuntime,
  newAgentAction,
  ownSignedInCli,
  signedInAs,
  visibleAgent,
} from './agentPresentation.ts'
import { boxAgents } from './boxPresentation.ts'

import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime.ts'

function local(id: string, deviceId: string, signedIn: boolean | null): RuntimeInstance {
  return {
    id,
    kind: 'local',
    provider: 'codex',
    label: id,
    status: 'active',
    createdAt: '',
    local: {
      deviceId,
      deviceLabel: deviceId === 'mac' ? 'MacBook Pro' : `Box ${deviceId}`,
      ownerUserId: 'owner',
      signedIn,
    },
  }
}

const teamAgent = (kind: 'managed' | 'external' | 'development'): RuntimeInstance => ({
  id: kind,
  kind,
  provider: 'codex',
  label: kind,
  status: 'active',
  createdAt: '',
})

test('Box cards and usage share signed-in local agents, retaining every team runtime', () => {
  const catalog = [
    local('box2-codex', '2', true),
    local('box2-claude', '2', false),
    local('box3-codex', '3', null),
    local('box3-claude', '3', false),
    local('mac-claude', 'mac', true),
    local('mac-codex', 'mac', true),
    teamAgent('managed'),
    { ...teamAgent('external'), status: 'disabled' as const },
    teamAgent('development'),
    { ...teamAgent('managed'), id: 'missing-local', kind: 'local' as const },
  ]
  const visible = catalog.filter(visibleAgent)
  const cards = ['2', '3', 'mac'].flatMap((device) =>
    boxAgents(device, catalog).filter(visibleAgent),
  )

  assert.deepEqual(
    cards.map((agent) => agent.id),
    ['box2-codex', 'mac-claude', 'mac-codex'],
  )
  assert.deepEqual(
    visible.filter((agent) => agent.kind === 'local'),
    cards,
  )
  assert.deepEqual(
    visible.filter((agent) => agent.kind !== 'local').map((agent) => agent.id),
    ['managed', 'external', 'development'],
  )
  assert.equal(visible.filter((agent) => agent.label.includes('box3')).length, 0)
  assert.equal(
    visible.find((agent) => agent.id === 'box2-claude'),
    undefined,
  )
  assert.equal(visible.find((agent) => agent.id === 'box2-codex')?.id, 'box2-codex')
  assert.equal(catalog.length, 10, 'presentation never removes catalog / history data')
})

test('an agent signed in before stays when it signs out; one never signed in stays hidden', () => {
  const box = (signedIn: boolean | null, everSignedIn?: true) =>
    ({
      ...local('a', '2', signedIn),
      local: { ...local('a', '2', signedIn).local!, ...(everSignedIn ? { everSignedIn } : {}) },
    }) as RuntimeInstance

  assert.equal(visibleAgent(box(false, true)), true)
  assert.equal(visibleAgent(box(null, true)), true)
  assert.equal(visibleAgent(box(false)), false)
  assert.equal(visibleAgent(box(null)), false)
})

test('Runs on uses the actual current device, labels remote Boxes, and handles missing identity', () => {
  const here = { userId: 'owner', deviceId: 'mac' }
  const box = local('codex', '2', true)
  const mac = local('claude', 'mac', true)

  assert.ok(box.local)
  assert.equal(agentRunsOn(box, here), 'Box 2')
  assert.equal(agentRunsOn(mac, here), 'This computer')
  assert.equal(agentRunsOn(mac), 'MacBook Pro')
  // The same machine signed in here with another account is that account's computer, not this one.
  assert.equal(agentRunsOn(mac, { userId: 'other', deviceId: 'mac' }), 'MacBook Pro')
  assert.equal(agentRunsOn({ ...box, status: 'disabled' }, here), 'Box 2 · Disabled')
  assert.equal(agentRunsOn({ ...box, local: undefined }), 'Computer')
  assert.equal(agentRunsOn({ ...box, local: { ...box.local, deviceLabel: '' } }, here), 'Computer')
  assert.equal(agentRunsOn(teamAgent('managed'), here), 'Cloud')
  assert.equal(agentRunsOn(teamAgent('external'), here), 'Self-hosted')
  assert.equal(agentRunsOn(teamAgent('development'), here), 'Development')
})

test('a computer agent is named by its provider; team runtimes keep their own names', () => {
  const local = {
    kind: 'local',
    provider: 'claude-code',
    label: 'Claude Code in Mac',
  } as RuntimeInstance
  const managed = { kind: 'managed', provider: 'codex', label: 'Prod Codex' } as RuntimeInstance

  assert.equal(agentName(local), 'Claude Code')
  assert.equal(agentName(managed), 'Prod Codex')
})

test('a listed agent goes by its account where its computer has one; its name is what Rename edits', () => {
  const summary = {
    ownerUserId: 'u',
    deviceId: 'mac',
    deviceLabel: 'Mac',
    signedIn: true,
    agentLabel: 'Claude Code 2',
  }
  const named = {
    kind: 'local',
    provider: 'claude-code',
    label: 'Claude Code in Mac',
    local: summary,
  } as RuntimeInstance
  const labelled = {
    ...named,
    local: { ...summary, accountLabel: 'Claude Code · sam@example.com' },
  } as RuntimeInstance

  assert.equal(agentDisplayName(named), 'Claude Code 2')
  assert.equal(agentDisplayName(labelled), 'Claude Code · sam@example.com')
  assert.equal(agentName(labelled), 'Claude Code 2')
})

test('a name a person gave an agent is kept when its computer holds more than one account', () => {
  const summary = {
    ownerUserId: 'u',
    deviceId: 'mac',
    deviceLabel: 'Mac',
    signedIn: true,
    accountLabel: 'Claude Code · sam@example.com',
  }
  const shown = (agentLabel: string) =>
    agentDisplayName({
      kind: 'local',
      provider: 'claude-code',
      label: `${agentLabel} in Mac`,
      local: { ...summary, agentLabel },
    } as RuntimeInstance)

  assert.equal(shown('Reviewer'), 'Reviewer')
  // Its provider's own name, and the number its computer adds to a second agent, are not the
  // person's: those give way to the account.
  assert.equal(shown('Claude Code'), 'Claude Code · sam@example.com')
  assert.equal(shown('Claude Code 2'), 'Claude Code · sam@example.com')
})

test("an away computer's signed-in agent stays visible and reads Offline", () => {
  const away = {
    id: 'a',
    kind: 'local',
    provider: 'codex',
    status: 'active',
    label: 'Codex',
    local: {
      deviceId: 'box',
      deviceLabel: 'Box 1',
      ownerUserId: 'u',
      signedIn: true,
      online: false,
    },
  } as RuntimeInstance
  const back = { ...away, local: { ...away.local!, online: true } } as RuntimeInstance

  assert.equal(visibleAgent(away), true)
  assert.equal(agentOffline(away), true)
  assert.equal(agentRunsOn(away), 'Box 1 · Offline')
  assert.equal(agentOffline(back), false)
  assert.equal(agentRunsOn(back), 'Box 1')
})

test('a self-hosted agent reads offline only when its Usage reading could not reach it', () => {
  const selfHosted = {
    id: 'r',
    kind: 'external',
    provider: 'claude-code',
    status: 'active',
    label: 'localhost',
  } as RuntimeInstance
  const quota = (offline: boolean) =>
    ({
      runtimeId: 'r',
      available: false,
      windows: [],
      ...(offline ? { offline: true } : {}),
    }) as RuntimeQuota

  assert.equal(agentOffline(selfHosted, quota(true)), true)
  assert.equal(agentRunsOn(selfHosted, undefined, quota(true)), 'Self-hosted · Offline')
  assert.equal(agentOffline(selfHosted, quota(false)), false, 'no usage is not offline')
  // Picking it for a conversation follows readiness, not the dot.
  assert.equal(agentOffline({ ...selfHosted, notReady: true }), false)
})

test("a person's own default agent is removable only while its CLI is signed out", () => {
  const signedIn = local('mac-codex', 'mac', true)
  const computer = local('mac-codex', 'mac', false)
  const box = { ...signedIn, local: { ...signedIn.local!, box: { provider: 'instabox' } } }

  // Its computer's report lists a signed-in CLI whatever Nuphos forgets (#2846).
  assert.equal(ownSignedInCli(signedIn), true)
  assert.equal(localRemovalId(signedIn), undefined)
  assert.equal(
    localRemovalId({ ...signedIn, local: { ...signedIn.local!, online: false } }),
    undefined,
  )
  // Online or not: a signed-out default Nuphos forgets stays hidden until it signs in again.
  assert.equal(ownSignedInCli(computer), false)
  assert.equal(localRemovalId(computer), 'codex')
  assert.equal(
    localRemovalId({ ...computer, local: { ...computer.local!, online: true } }),
    'codex',
  )
  assert.equal(
    localRemovalId({ ...computer, local: { ...computer.local!, online: false } }),
    'codex',
  )
  // A Box's default agent and an added agent are deleted on the computer, signed in or not.
  assert.equal(ownSignedInCli(box as RuntimeInstance), false)
  assert.equal(localRemovalId(box as RuntimeInstance), 'codex')
  assert.equal(
    localRemovalId({ ...signedIn, local: { ...signedIn.local!, instanceId: 'id-1' } }),
    'id-1',
  )
  assert.equal(localRemovalId({ ...computer, kind: 'managed', local: undefined }), undefined)
})

test("a computer's agent goes by the name given to it, else its provider's", () => {
  const agent = local('a', 'mac', true)

  assert.equal(agentName(agent), 'Codex')
  assert.equal(agentName({ ...agent, local: { ...agent.local!, agentLabel: 'Review' } }), 'Review')
})

test('every signed-out agent can sign in, by its own CLI or the runtime sign-in', () => {
  const here = { userId: 'owner', deviceId: 'mac' }
  const codex = local('a', 'mac', false)
  const added = { ...codex, local: { ...codex.local!, instanceId: 'x' } }

  // This computer's default Claude Code or Codex agent: its own CLI.
  assert.equal(localSignIn(codex, here), 'codex')
  assert.equal(localSignIn(local('a', 'mac', null), here), 'codex')
  // An added agent, or any agent on another computer, has a login of its own that only the
  // runtime sign-in reaches.
  assert.equal(localSignIn(added, here), 'runtime')
  assert.equal(localSignIn(local('a', 'box1', false), here), 'runtime')
  assert.equal(localSignIn(local('a', 'box1', false), null), 'runtime')
  // The same machine, signed in here with another account: its agents are not this computer's CLI's.
  assert.equal(localSignIn(codex, { userId: 'other', deviceId: 'mac' }), 'runtime')
  assert.equal(localSignIn({ ...codex, provider: 'grok' }, here), 'runtime')
  // One whose sign-in ended is renewed only through Nuphos, not by the CLI's own login.
  assert.equal(
    localSignIn({ ...codex, local: { ...codex.local!, signInEnded: true } }, here),
    'runtime',
  )
  // Signed in already, or a team runtime: nothing to offer.
  assert.equal(localSignIn(local('a', 'mac', true), here), undefined)
  assert.equal(localSignIn(local('a', 'box1', true), here), undefined)
  assert.equal(localSignIn(teamAgent('managed'), here), undefined)
})

test("a computer's owner and managers rename, remove and sign in its agents; its users do not", () => {
  const agent = local('a', 'box1', false)

  assert.equal(managesRuntime(agent, { access: 'owner' }, false), true)
  assert.equal(managesRuntime(agent, { access: 'manage' }, false), true)
  assert.equal(managesRuntime(agent, { access: 'use' }, false), false)
  // Team roles confer nothing on a computer (box-access.ts).
  assert.equal(managesRuntime(agent, { access: 'use' }, true), false)
  // The viewer's own computer, listed without an access field.
  assert.equal(managesRuntime(agent, {}, false), true)
  // Not in the computer list yet: no controls the backend could refuse.
  assert.equal(managesRuntime(agent, undefined, true), false)
  // A team runtime is its administrators'.
  assert.equal(managesRuntime(teamAgent('external'), undefined, true), true)
  assert.equal(managesRuntime(teamAgent('external'), undefined, false), false)
})

const hostAgent = (id: string, provider: RuntimeInstance['provider'], signedIn: boolean | null) =>
  ({
    id,
    provider,
    kind: 'local',
    local: { deviceId: 'a', signedIn },
  }) as RuntimeInstance

test('New Agent signs in a signed-out agent of that provider before it adds another', () => {
  const agents = [hostAgent('claude', 'claude-code', true), hostAgent('codex', 'codex', null)]
  const lapsed = [
    hostAgent('claude', 'claude-code', false),
    hostAgent('claude-2', 'claude-code', true),
  ]

  // A lapsed sign-in is signed in again, never turned into "Claude Code 2".
  // A new computer whose first sign-in was cancelled: its agent is hidden (never signed in), so
  // New runtime is the way back to it.
  const fresh = hostAgent('claude', 'claude-code', false)

  assert.equal(visibleAgent(fresh), false)
  assert.deepEqual(newAgentAction([fresh], 'claude-code'), { signIn: 'claude' })
  assert.deepEqual(newAgentAction(lapsed, 'claude-code'), { signIn: 'claude' })
  assert.deepEqual(newAgentAction(agents, 'codex'), { signIn: 'codex' })
  // Every agent of the provider signed in: add one.
  assert.deepEqual(newAgentAction(agents, 'claude-code'), { create: true })
})

test('New Agent adds one to a computer that lists no agents yet', () => {
  // Its agents are not running yet, or no agent CLI is installed: nothing says the host is old.
  assert.deepEqual(newAgentAction([], 'codex'), { create: true })
  assert.deepEqual(newAgentAction([], 'claude-code'), { create: true })
})

test('AGY only offers its existing shared sign-in, never a second account', () => {
  assert.equal(newAgentAction([], 'antigravity'), null)
  const signedIn = {
    id: 'agy',
    provider: 'antigravity',
    local: { signedIn: true },
  } as RuntimeInstance

  assert.equal(newAgentAction([signedIn], 'antigravity'), null)
  assert.deepEqual(
    newAgentAction(
      [{ ...signedIn, local: { ...signedIn.local!, signedIn: false } }],
      'antigravity',
    ),
    { signIn: 'agy' },
  )
})

test('an agent card names who signed its agent in, or says it was the viewer', () => {
  assert.equal(signedInAs('Alice', 'u1', 'u2'), 'Signed in as Alice')
  assert.equal(signedInAs('Alice', 'u1', 'u1'), 'Signed in as you')
  assert.equal(signedInAs('Alice', 'u1', undefined), 'Signed in as Alice')
})
