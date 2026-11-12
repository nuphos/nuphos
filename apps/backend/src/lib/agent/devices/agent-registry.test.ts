import { expect, test } from 'bun:test'

import {
  ADDITION_GRACE_MS,
  goneAdditions,
  isPendingRemoval,
  mergeAgentRegistry,
  renameRegisteredAgent,
  reportedAgents,
} from './agent-registry'

import type { LocalRuntimeStatus } from './local-runtime/protocol'

const work = '11111111-1111-4111-8111-111111111111'
const orphan = '22222222-2222-4222-8222-222222222222'
const pending = '33333333-3333-4333-8333-333333333333'
const cli = (loggedIn: boolean | null) => ({ cli: { installed: true, loggedIn } })
const status = {
  agents: { 'claude-code': cli(true), codex: cli(false) },
  instances: [
    { instanceId: work, provider: 'claude-code', label: 'Work', ...cli(true) },
    { instanceId: orphan, provider: 'codex', label: 'Codex', ...cli(false) },
    { instanceId: pending, provider: 'codex', label: 'Codex', state: 'pending', ...cli(true) },
  ],
} as LocalRuntimeStatus

test('only agents seen signed in join, pending sign-ins never do', () => {
  expect(mergeAgentRegistry([], reportedAgents(status))).toEqual([
    { provider: 'claude-code', signedIn: true },
    { provider: 'claude-code', instanceId: work, label: 'Work', signedIn: true },
  ])
})

test('an agent whose CLI is not installed is not reported', () => {
  const missing = { cli: { installed: false, loggedIn: false } }
  const report = {
    agents: { grok: missing },
    instances: [{ instanceId: orphan, provider: 'opencode', label: 'OpenCode', ...missing }],
  } as LocalRuntimeStatus

  expect(reportedAgents(report)).toEqual([])
})

test('a registered agent keeps its place and name and takes the latest report, even signed out', () => {
  const registered = mergeAgentRegistry([], reportedAgents(status))!
  const later = {
    agents: { 'claude-code': cli(false) },
    instances: [{ instanceId: work, provider: 'claude-code', label: 'Renamed', ...cli(false) }],
  } as LocalRuntimeStatus

  expect(mergeAgentRegistry(registered, reportedAgents(later))).toEqual([
    { provider: 'claude-code', signedIn: false },
    { provider: 'claude-code', instanceId: work, label: 'Work', signedIn: false },
  ])
  // A report that leaves an agent out (offline, or its CLI gone) does not remove it.
  expect(mergeAgentRegistry(registered, [])).toBeNull()
  expect(mergeAgentRegistry(registered, reportedAgents(status))).toBeNull()
})

test('a name a person gave survives every later report; clearing it restores the default', () => {
  const registered = mergeAgentRegistry([], reportedAgents(status))!
  const renamed = renameRegisteredAgent(
    renameRegisteredAgent(registered, work, 'Review')!,
    'claude-code',
    'Main',
  )!

  expect(mergeAgentRegistry(renamed, reportedAgents(status))).toBeNull()
  expect(renamed).toEqual([
    { provider: 'claude-code', label: 'Main', signedIn: true },
    { provider: 'claude-code', instanceId: work, label: 'Review', signedIn: true },
  ])

  const cleared = renameRegisteredAgent(renamed, 'claude-code', '')!

  expect(cleared[0]).toEqual({ provider: 'claude-code', signedIn: true })
  // Its computer still reports the name it was created with; a cleared name stays cleared.
  expect(
    mergeAgentRegistry(renameRegisteredAgent(renamed, work, '')!, reportedAgents(status)),
  ).toBeNull()
  expect(renameRegisteredAgent(registered, orphan, 'Nope')).toBeNull()
})

test('who added an agent is kept while it exists, pending or registered, and dropped once it is gone', () => {
  const now = Date.parse('2026-10-21T08:00:00Z')
  const old = new Date(now - ADDITION_GRACE_MS)
  const gone = '44444444-4444-4444-8444-444444444444'
  const noted = (instanceId: string, at = old) => ({ instanceId, userId: 'u2', at })
  const registered = [{ provider: 'claude-code' as const, instanceId: work, signedIn: true }]
  const additions = [noted(work), noted(pending), noted(gone), noted(orphan, new Date(now))]
  const report = { ...status, instances: status.instances?.filter((i) => i.instanceId !== orphan) }

  // The host dropped `gone`; `orphan` was noted a moment ago and may not have reached it yet.
  expect(goneAdditions(additions, registered, report, now)).toEqual([gone])
  expect(goneAdditions([noted(work)], registered, report, now)).toEqual([])
  // An older host lists no agents of its own, so it never says one is gone.
  expect(goneAdditions(additions, [], { agents: {} }, now)).toEqual([])
})

test('a pending removal hides exactly the agent it names', () => {
  const removals = [
    { id: 'r1', agent: { instanceId: 'added' }, actorId: 'm', teamId: 't', at: new Date(0) },
    { id: 'r2', agent: { provider: 'codex' as const }, actorId: 'm', teamId: 't', at: new Date(0) },
  ]

  expect(isPendingRemoval({ provider: 'claude-code', instanceId: 'added' }, removals)).toBe(true)
  expect(isPendingRemoval({ provider: 'codex' }, removals)).toBe(true)
  // A provider's removal is its default agent, not an added agent of the same provider.
  expect(isPendingRemoval({ provider: 'codex', instanceId: 'other' }, removals)).toBe(false)
  expect(isPendingRemoval({ provider: 'claude-code' }, removals)).toBe(false)
})
