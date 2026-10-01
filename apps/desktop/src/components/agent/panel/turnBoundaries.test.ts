import assert from 'node:assert/strict'
import test from 'node:test'

import { startUserTurn, updateCurrentAssistantParts } from './turnBoundaries.ts'

import type { Message, Tab } from './model.ts'
import type { Part } from './parts.ts'

const credentialAccess: Tab['credentialAccess'] = {
  awsRoleIds: [],
  gcpServiceAccountIds: [],
  linodeAccountIds: [],
  hetznerAccountIds: [],
  betterStackIntegrationIds: [],
  uptimeKumaInstanceIds: [],
  onpremClusterIds: [],
  linearWorkspaceIds: [],
  jiraSiteIds: [],
  asanaAccountIds: [],
  sentryAccountIds: [],
  tailscaleClientIds: [],
  zeaburIds: [],
  vantaIntegrationIds: [],
  secureframeIntegrationIds: [],
  resendIntegrationIds: [],
}

function tab(messages: Message[]): Tab {
  return {
    id: 'tab',
    sessionId: 'session-1',
    title: 'Plan',
    messages,
    streaming: true,
    connected: false,
    streamId: 'run-2',
    streamStartedAt: null,
    error: null,
    autoResumeAttempts: 0,
    historyBaseIndex: 0,
    credentialAccess,
    readOnly: false,
  }
}

const planRequest: Message = {
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', text: 'Right-size CoreDNS' }],
}
const planAnswer: Message = {
  id: 'assistant-1',
  role: 'assistant',
  parts: [
    {
      type: 'memory-provenance',
      id: 'session-1:memprov',
      sessionId: 'session-1',
      personalIds: ['m1'],
      teamIds: [],
      fetchedIds: [],
      fetchedCount: 0,
      turnKey: 'turn-1',
      createdAt: '2026-09-18T04:00:00.000Z',
    },
    { type: 'tool', toolCallId: 'call-1', toolName: 'bash', state: 'output-available' },
    { type: 'text', text: 'Plan #522 is ready for approval.' },
  ],
}
const approval: Message = {
  id: 'user-2',
  role: 'user',
  parts: [{ type: 'text', text: 'Approved plan #522 — please proceed with plan #522.' }],
}

let nextId = 0
const newId = () => `local-${String(++nextId)}`

type Frame =
  | { type: 'atlas-turn-start'; messages: Message[] }
  | { type: 'memory-provenance'; recalled: string[]; turnKey: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; toolCallId: string }

function appendPart(parts: Part[], frame: Exclude<Frame, { type: 'atlas-turn-start' }>): Part[] {
  if (frame.type === 'text') return [...parts, { type: 'text', text: frame.text }]
  if (frame.type === 'tool') {
    if (parts.some((part) => part.type === 'tool' && part.toolCallId === frame.toolCallId))
      return parts

    return [
      ...parts,
      { type: 'tool', toolCallId: frame.toolCallId, toolName: 'bash', state: 'input-available' },
    ]
  }

  return [
    ...parts.filter(
      (part) => !(part.type === 'memory-provenance' && part.id === 'session-1:memprov'),
    ),
    {
      type: 'memory-provenance',
      id: 'session-1:memprov',
      sessionId: 'session-1',
      personalIds: frame.recalled,
      teamIds: [],
      fetchedIds: [],
      fetchedCount: 0,
      turnKey: frame.turnKey,
      createdAt: '2026-09-18T04:32:00.000Z',
    },
  ]
}

function replay(start: Tab, frames: Frame[]): Tab {
  return frames.reduce((current, frame) => {
    if (frame.type === 'atlas-turn-start') return startUserTurn(current, 'run-2', frame.messages)

    return {
      ...current,
      messages: updateCurrentAssistantParts(current.messages, newId, (parts) =>
        appendPart(parts, frame),
      ),
    }
  }, start)
}

const run: Frame[] = [
  { type: 'atlas-turn-start', messages: [structuredClone(approval)] },
  { type: 'memory-provenance', recalled: ['m1', 'm2', 'm3', 'm4', 'm5'], turnKey: 'turn-2' },
  { type: 'text', text: 'I will run plan #522.' },
  { type: 'tool', toolCallId: 'call-1' },
  { type: 'tool', toolCallId: 'call-2' },
  { type: 'tool', toolCallId: 'call-3' },
  { type: 'tool', toolCallId: 'call-4' },
]

function shape(messages: Message[]) {
  return messages.map((message) => ({
    role: message.role,
    ...(message.role === 'user' ? { id: message.id } : {}),
    tools: message.parts.filter((part) => part.type === 'tool').length,
    recalled: message.parts.flatMap((part) =>
      part.type === 'memory-provenance'
        ? [`${part.turnKey ?? ''}:${String(part.personalIds.length)}`]
        : [],
    ),
  }))
}

test('the device that did not approve the plan renders the approval and a separate turn', () => {
  const approver = replay(tab([planRequest, planAnswer, approval]), run)
  const other = replay(tab([planRequest, planAnswer]), run)

  assert.deepEqual(shape(other.messages), shape(approver.messages))
  assert.deepEqual(shape(other.messages), [
    { role: 'user', id: 'user-1', tools: 0, recalled: [] },
    { role: 'assistant', tools: 1, recalled: ['turn-1:1'] },
    { role: 'user', id: 'user-2', tools: 0, recalled: [] },
    { role: 'assistant', tools: 4, recalled: ['turn-2:5'] },
  ])
})

test('without the turn start the other device folds the new turn into the previous answer', () => {
  const other = replay(tab([planRequest, planAnswer]), run.slice(1))

  assert.deepEqual(shape(other.messages), [
    { role: 'user', id: 'user-1', tools: 0, recalled: [] },
    { role: 'assistant', tools: 4, recalled: ['turn-2:5'] },
  ])
})

test('the approving device keeps its own copy of the message', () => {
  const approver = tab([planRequest, planAnswer, approval])

  assert.equal(startUserTurn(approver, 'run-2', [structuredClone(approval)]), approver)
})

test('a device joining mid-turn drops the stored partial answer that the replay rebuilds', () => {
  const partial: Message = {
    id: 'stored-partial',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'I will run plan #522.' },
      { type: 'tool', toolCallId: 'call-1', toolName: 'bash', state: 'output-available' },
    ],
  }
  const approver = replay(tab([planRequest, planAnswer, approval]), run)
  const lateJoiner = replay(tab([planRequest, planAnswer, approval, partial]), run)

  assert.deepEqual(shape(lateJoiner.messages), shape(approver.messages))
})

test('turn start ignores another run and input with no user message', () => {
  const current = tab([planRequest, planAnswer])

  assert.equal(startUserTurn(current, 'run-1', [approval]), current)
  assert.equal(startUserTurn(current, 'run-2', [planAnswer]), current)
})

test('output without a change never opens an empty assistant message', () => {
  const messages = [planRequest]

  assert.equal(
    updateCurrentAssistantParts(messages, newId, (parts) => parts),
    messages,
  )
})

test('turn start replaces optimistic attribution with server metadata without losing local parts', () => {
  const own: Message = { id: 'input', role: 'user', parts: [{ type: 'text', text: 'hello' }] }
  const metadata: NonNullable<Message['metadata']> = {
    version: 1,
    sender: { type: 'user', id: 'verified', displayName: 'Yuan' },
    source: 'nuphos',
    sentAt: '2026-09-27T10:00:00Z',
  }

  own.metadata = { ...metadata, sender: { type: 'user', id: 'local', displayName: 'Old name' } }
  const result = startUserTurn(tab([own]), 'run-2', [{ ...own, parts: [], metadata }])

  assert.deepEqual(result.messages[0]?.metadata, metadata)
  assert.equal(result.messages[0]?.parts, own.parts)
})
