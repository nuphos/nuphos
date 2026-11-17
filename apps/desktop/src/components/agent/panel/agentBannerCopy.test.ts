import assert from 'node:assert/strict'
import { test } from 'node:test'

import { reachabilityCopy } from './agentBannerCopy.ts'
import { agentProblem } from './agentRowFix.ts'

import type { AgentFix, AgentRowViewer } from './agentRowFix.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'

function agent(
  owner: string,
  local: Partial<NonNullable<RuntimeInstance['local']>>,
): RuntimeInstance {
  return {
    id: `local_${owner}_d1`,
    provider: 'claude-code',
    label: 'Claude Code',
    status: 'active',
    kind: 'local',
    createdAt: '2026-01-01T00:00:00Z',
    local: {
      ownerUserId: owner,
      deviceId: 'd1',
      deviceLabel: 'Studio Mac',
      online: true,
      signedIn: false,
      ...local,
    },
  }
}

/** The banner as the composer shows it: the picker's fix for the agent, then its words. */
function banner(
  instance: RuntimeInstance,
  viewer: Partial<AgentRowViewer> = {},
  onSwitchAgent?: () => void,
  ask: { canAsk?: boolean; askedName?: string } = {},
) {
  const runs: AgentFix[] = []
  const fix = agentProblem(instance, undefined, {
    viewerId: 'u-alex',
    isTeamAdmin: false,
    onThisComputer: () => false,
    members: null,
    manages: () => false,
    ...viewer,
  })?.fix
  const reachability = instance.local?.online === false ? 'offline' : 'signIn'
  const copy = reachabilityCopy(
    reachability,
    { value: instance, options: [instance] },
    fix,
    {
      run: (run) => runs.push(run),
      canAsk: () => ask.canAsk ?? false,
      ...(ask.askedName && { askedName: ask.askedName }),
    },
    onSwitchAgent,
  )

  copy.action?.run()

  return { ...copy, runs }
}

test("this computer's own signed-out agent signs in through its CLI, for members too", () => {
  const copy = banner(agent('u-alex', {}), { onThisComputer: () => true })

  assert.equal(copy.text, 'Claude Code on Studio Mac is signed out. Sign it in to send messages.')
  assert.equal(copy.action?.label, 'Sign in')
  assert.deepEqual(copy.runs, [{ kind: 'cli', provider: 'claude-code' }])
})

test('your own other computer signs in with the runtime sign-in', () => {
  const instance = agent('u-alex', {})
  const copy = banner(instance)

  assert.equal(copy.action?.label, 'Sign in')
  assert.deepEqual(copy.runs, [{ kind: 'signIn', instance }])
})

test("a teammate's computer is left to its owner", () => {
  const copy = banner(agent('u-taylor', {}), { isTeamAdmin: true })

  assert.equal(copy.text, 'Claude Code on Studio Mac is signed out. Ask its owner to sign it in.')
  assert.equal(copy.action, null)
})

test('offline: your own paused Box resumes, anything else retries, a new chat switches', () => {
  const paused = agent('u-alex', { online: false, box: { state: 'paused' } })

  assert.deepEqual(banner(paused).runs, [{ kind: 'resume', deviceId: 'd1', runtimeId: paused.id }])
  assert.deepEqual(banner(agent('u-alex', { online: false })).runs, [{ kind: 'retry' }])

  let switched = false
  const copy = banner(agent('u-alex', { online: false }), {}, () => {
    switched = true
  })

  assert.equal(copy.action?.label, 'Switch runtime')
  assert.ok(switched)
})

test("in a conversation, a teammate's signed-out computer offers to ask its owner", () => {
  const instance = agent('u-taylor', {})
  const members = [
    {
      id: 'u-taylor',
      name: 'Taylor',
      email: 't@example.com',
      username: 't',
      role: 'MEMBER' as const,
      joinedAt: '2026-01-01T00:00:00Z',
    },
  ]
  const copy = banner(instance, { members }, undefined, { canAsk: true })

  assert.equal(copy.action?.label, 'Ask Taylor to sign in')
  assert.deepEqual(copy.runs, [{ kind: 'ask', name: 'Taylor', runtimeId: instance.id }])
})

test('once asked, the banner says who, with nothing more to press', () => {
  const copy = banner(agent('u-taylor', {}), {}, undefined, { canAsk: true, askedName: 'Taylor' })

  assert.equal(copy.text, 'Asked Taylor. You can send once they sign it in.')
  assert.equal(copy.action, null)
})
