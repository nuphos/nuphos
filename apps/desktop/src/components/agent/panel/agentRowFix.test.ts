import assert from 'node:assert/strict'
import { test } from 'node:test'

import { agentAskText, agentFixLabel, agentProblem, resumeComputer } from './agentRowFix.ts'

import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime.ts'
import type { TeamMember } from '../../../types/team.ts'

const members: TeamMember[] = [
  {
    id: 'u-bryan',
    name: 'Bryan',
    email: 'b@example.com',
    username: 'b',
    role: 'ADMINISTRATOR',
    joinedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'u-shant',
    name: 'Shant',
    email: 's@example.com',
    username: 's',
    role: 'EDITOR',
    joinedAt: '2025-06-01T00:00:00Z',
  },
]
const managed: RuntimeInstance = {
  id: 'rt-prod',
  provider: 'claude-code',
  label: 'runtime-production-4733',
  status: 'active',
  kind: 'managed',
  createdAt: '2026-01-01T00:00:00Z',
}
const signedOutQuota: RuntimeQuota = {
  runtimeId: 'rt-prod',
  provider: 'claude-code',
  fetchedAt: '2026-01-01T00:00:00Z',
  available: false,
  reason: 'Sign in required',
  windows: [],
}

function local(
  owner: string,
  extra: Partial<NonNullable<RuntimeInstance['local']>>,
): RuntimeInstance {
  return {
    ...managed,
    id: `local_${owner}_d1`,
    kind: 'local',
    local: {
      ownerUserId: owner,
      deviceId: 'd1',
      deviceLabel: 'Build Box',
      online: true,
      signedIn: true,
      ...extra,
    },
  }
}

const viewer = (viewerId: string, isTeamAdmin = false, here = false) => ({
  viewerId,
  isTeamAdmin,
  onThisComputer: () => here,
  members,
})

test('a ready agent has no problem', () => {
  assert.equal(agentProblem(managed, undefined, viewer('u-shant')), null)
  assert.equal(agentProblem(local('u-shant', {}), undefined, viewer('u-shant')), null)
})

test('a signed-out team agent: the administrator signs it in, a member asks them', () => {
  const admin = agentProblem(managed, signedOutQuota, viewer('u-bryan', true))
  const member = agentProblem(managed, signedOutQuota, viewer('u-shant'))

  assert.deepEqual(admin?.fix, { kind: 'signIn', instance: managed })
  assert.deepEqual(member?.fix, { kind: 'ask', name: 'Bryan' })
  // The probe's sign-in hint can be wrong, so the agent can still be picked.
  assert.equal(member?.pickable, true)
  assert.equal(agentAskText({ kind: 'ask', name: 'Bryan' }), 'Ask Bryan')
})

test("this computer's signed-out CLI signs in with its own login and cannot be picked", () => {
  const problem = agentProblem(
    local('u-shant', { signedIn: false }),
    undefined,
    viewer('u-shant', false, true),
  )

  assert.deepEqual(problem?.fix, { kind: 'cli', provider: 'claude-code' })
  assert.equal(problem?.pickable, false)
  assert.equal(agentFixLabel(problem!.fix), 'Sign in')
})

test("a teammate's signed-out computer is signed in by its owner", () => {
  const problem = agentProblem(local('u-bryan', { signedIn: false }), undefined, viewer('u-shant'))

  assert.deepEqual(problem?.fix, { kind: 'ask', name: 'Bryan' })
})

test("your own paused Box resumes; someone else's asks its owner; an offline computer retries", () => {
  const paused = { online: false, box: { state: 'paused' as const } }

  assert.deepEqual(agentProblem(local('u-shant', paused), undefined, viewer('u-shant'))?.fix, {
    kind: 'resume',
    deviceId: 'd1',
    runtimeId: 'local_u-shant_d1',
  })
  assert.deepEqual(agentProblem(local('u-bryan', paused), undefined, viewer('u-shant'))?.fix, {
    kind: 'ask',
    name: 'Bryan',
  })
  const offline = agentProblem(local('u-shant', { online: false }), undefined, viewer('u-shant'))

  assert.equal(offline?.reason, 'Offline')
  assert.deepEqual(offline?.fix, { kind: 'retry' })
  assert.equal(agentFixLabel(offline!.fix), 'Retry')
})

test('without the member list the ask names no one yet', () => {
  const problem = agentProblem(managed, signedOutQuota, { ...viewer('u-shant'), members: null })

  assert.deepEqual(problem?.fix, { kind: 'ask', name: null })
  assert.equal(agentAskText({ kind: 'ask', name: null }), 'Ask an administrator')
})

test('OpenCode on your own computer signs in with the runtime sign-in, not settings', () => {
  const opencode = { ...local('u-shant', { signedIn: false }), id: 'local_u-shant_d1_opencode' }

  assert.deepEqual(agentProblem(opencode, undefined, viewer('u-shant', false, true))?.fix, {
    kind: 'signIn',
    instance: opencode,
  })
})

test('Resume wakes through the sign-in wake path, waking only while the request runs', async () => {
  for (const succeeds of [true, false]) {
    const events: string[] = []

    await resumeComputer({
      fix: { kind: 'resume', deviceId: 'd1', runtimeId: 'local_u-shant_d1' },
      wake: async (runtimeId) => {
        events.push(`wake ${runtimeId}`)
        if (!succeeds) throw new Error('402')
      },
      begin: (deviceId) => {
        events.push(`begin ${deviceId}`)

        return () => events.push(`end ${deviceId}`)
      },
      onResumed: () => events.push('resumed'),
      onFailed: () => events.push('failed'),
    })
    assert.deepEqual(events, [
      'begin d1',
      'wake local_u-shant_d1',
      succeeds ? 'resumed' : 'failed',
      'end d1',
    ])
  }
})
