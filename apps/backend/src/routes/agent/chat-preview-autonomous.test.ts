import { describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import { createClaudeCodeAutonomousUpdateHandler } from './chat-preview-autonomous'

import type { ClaudeCodeAutonomousContext } from '@/lib/claude-code-preview/agent-chat-runtime'

// Persistence itself is covered by the DB helper; these tests isolate turn
// routing and lifecycle ordering.
const persistedIds: string[] = []
let persist: () => Promise<boolean> = async () => false

useAgentDb({
  appendAutonomousConversationTurn: (args) => {
    persistedIds.push(args.message.id)

    return persist()
  },
})

const context: ClaudeCodeAutonomousContext = {
  teamId: 'team-1',
  conversationId: 'conversation-1',
  userId: 'actor-1',
  conversationOwnerUserId: 'owner-1',
  locale: 'en-US',
}

const request = {
  sessionId: 'openab-1',
  toolCall: { toolCallId: 'tool-1', title: 'Run kubectl delete' },
  options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
}

function harness() {
  const authorizeCalls: Record<string, unknown>[] = []
  const begins: ClaudeCodeAutonomousContext[] = []
  const messageIds: string[] = []
  const frames: Record<string, unknown>[] = []
  const calls: string[] = []
  const handler = createClaudeCodeAutonomousUpdateHandler({
    begin: (begun, messageId) => {
      begins.push(begun)
      messageIds.push(messageId)

      return {
        emit: (frame) => {
          calls.push('emit')
          frames.push(frame)
        },
        finish: () => {
          calls.push('finish')
        },
        handleTool: () => {},
        toolSteps: () => [],
        reportError: () => {
          calls.push('error')
        },
      }
    },
    authorize: (args) => {
      authorizeCalls.push(args)

      return Promise.resolve({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    },
  })

  return { handler, authorizeCalls, begins, frames, calls, messageIds }
}

describe('autonomous turn permission routing', () => {
  test('passes the actor as userId and the durable owner as conversationOwnerUserId', async () => {
    const h = harness()

    expect(await h.handler.permission({ ...context, request })).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    })
    expect(h.authorizeCalls).toHaveLength(1)
    expect(h.authorizeCalls[0]).toMatchObject({
      userId: 'actor-1',
      conversationOwnerUserId: 'owner-1',
      conversationId: 'conversation-1',
    })
  })

  test('reuses the turn an autonomous update already opened', async () => {
    const h = harness()

    void h.handler.update({ ...context, update: { kind: 'text', text: 'Timer fired.' } })
    await h.handler.permission({ ...context, request })

    expect(h.begins).toHaveLength(1)
    expect(h.begins[0]?.conversationOwnerUserId).toBe('owner-1')
    expect(h.frames[0]).toEqual({ type: 'text-delta', delta: 'Timer fired.' })
  })
})

describe('autonomous turn interruption', () => {
  test('reports the error before the turn is finished', async () => {
    const h = harness()

    await h.handler.update({ ...context, update: { kind: 'text', text: 'Writing the note…' } })
    await h.handler.update({
      ...context,
      update: { kind: 'interrupted', reason: 'connection_closed' },
    })

    // `reportError` appends the error frame; `finish` writes the terminal ones.
    // Reversed, the client would see a completed turn with an error after it.
    expect(h.calls).toEqual(['emit', 'error', 'finish'])
  })

  test('a normal completion finishes without an error', async () => {
    const h = harness()

    await h.handler.update({ ...context, update: { kind: 'text', text: 'Done.' } })
    await h.handler.update({
      ...context,
      update: { kind: 'complete', origin: { kind: 'task-notification' } },
    })

    expect(h.calls).toEqual(['emit', 'finish'])
  })
})

test('actual output opens a turn, and idle closes it without waiting for storage', async () => {
  const h = harness()
  let release!: (value: boolean) => void

  persist = () =>
    new Promise<boolean>((resolve) => {
      release = resolve
    })
  try {
    await h.handler.update({ ...context, update: { kind: 'status', status: 'active' } })
    expect(h.begins).toHaveLength(0)
    await h.handler.update({ ...context, update: { kind: 'text', text: 'Done' } })
    await h.handler.update({ ...context, update: { kind: 'complete' } })
    expect(h.calls).toEqual(['emit', 'finish'])
    await h.handler.update({ ...context, update: { kind: 'status', status: 'active' } })
    expect(h.begins).toHaveLength(1)
    await h.handler.update({ ...context, update: { kind: 'text', text: 'Next continuation' } })
    expect(h.begins).toHaveLength(2)
    release(false)
  } finally {
    persist = async () => false
  }
})

test('runtime status broadcasts do not invent autonomous transcript turns', async () => {
  const h = harness()

  for (const phase of ['configuring', 'loading', 'working', 'resuming', 'finishing']) {
    await h.handler.update({
      ...context,
      update: {
        kind: 'status',
        status: 'active',
        runtimeSnapshot: { schemaVersion: 2, state: 'active', phase },
      },
    })
  }
  await h.handler.update({ ...context, update: { kind: 'complete' } })
  expect(h.begins).toHaveLength(0)
  expect(h.frames).toHaveLength(0)

  await h.handler.update({
    ...context,
    update: { kind: 'text', text: 'Actual runtime continuation' },
  })
  await h.handler.update({
    ...context,
    update: {
      kind: 'status',
      status: 'active',
      runtimeSnapshot: { schemaVersion: 2, state: 'active', phase: 'resuming' },
    },
  })
  expect(h.begins).toHaveLength(1)
  expect(h.frames.at(-1)).toMatchObject({ type: 'runtime-state', snapshot: { phase: 'resuming' } })
})

test('persisted autonomous message keeps the identity sent with its start event', async () => {
  const h = harness()

  await h.handler.update({ ...context, update: { kind: 'text', text: 'Continued' } })
  await h.handler.update({ ...context, update: { kind: 'complete' } })
  expect(persistedIds.at(-1)).toBe(h.messageIds[0])
})
