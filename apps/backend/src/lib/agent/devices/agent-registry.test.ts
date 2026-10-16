import { expect, test } from 'bun:test'

import { mergeAgentRegistry, renameRegisteredAgent, reportedAgents } from './agent-registry'

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
