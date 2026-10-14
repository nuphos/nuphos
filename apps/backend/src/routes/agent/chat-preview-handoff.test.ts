import { afterEach, expect, test } from 'bun:test'

import { continueLostTurn } from './chat-preview-handoff'

import type { TeamSession } from '@/lib/claude-code-preview/team-openab-runtime'
import type { UIMessage } from 'ai'

import { sessionsByConversation } from '@/lib/claude-code-preview/agent-chat-registry'

const threadMessage = (id: string): UIMessage => ({
  id,
  role: 'user',
  metadata: {
    version: 1,
    sender: { type: 'agent', id: 'parent', displayName: 'Nuphos agent' },
    source: 'agent.thread',
    sourceSessionId: 'parent',
    sentAt: '2026-10-14T00:00:00.000Z',
  },
  parts: [{ type: 'text', text: 'run the tests' }],
})

const appMessage: UIMessage = {
  id: 'from-app',
  role: 'user',
  metadata: {
    version: 1,
    sender: { type: 'user', id: 'user', displayName: 'User' },
    source: 'nuphos',
    sentAt: '2026-10-14T00:00:00.000Z',
  },
  parts: [{ type: 'text', text: 'run the tests' }],
}

function attach(reattached: boolean, runtimeState: string) {
  sessionsByConversation.set('team:conv', {
    teamId: 'team',
    conversationId: 'conv',
    openabSessionId: 'sess-1',
    reattached: Promise.resolve(reattached),
    client: {
      getSessionExecutionState: async () => ({ state: runtimeState }),
    },
  } as unknown as TeamSession)
}

function turn(messages: UIMessage[]) {
  return { sessionId: 'conv', teamId: 'team', userId: 'user', locale: 'en-US', messages }
}

function recorder() {
  const delivered: { messageId: string; source: string; sourceSessionId?: string }[] = []

  return {
    delivered,
    deliver: async (
      _turn: unknown,
      messageId: string,
      metadata: { source: string; sourceSessionId?: string },
    ) => {
      delivered.push({
        messageId,
        source: metadata.source,
        sourceSessionId: metadata.sourceSessionId,
      })
    },
  }
}

afterEach(() => sessionsByConversation.delete('team:conv'))

test('a thread turn whose runtime died continues once the session is back and idle', async () => {
  attach(true, 'idle')
  const { delivered, deliver } = recorder()

  await continueLostTurn(turn([threadMessage('m1')]), deliver)

  expect(delivered).toEqual([
    { messageId: 'm1:continued', source: 'agent.thread', sourceSessionId: 'parent' },
  ])
})

test('a runtime still running the turn keeps it; nothing is sent', async () => {
  attach(true, 'active')
  const { delivered, deliver } = recorder()

  await continueLostTurn(turn([threadMessage('m1')]), deliver)

  expect(delivered).toEqual([])
})

test('a session that never came back is not prompted', async () => {
  attach(false, 'idle')
  const { delivered, deliver } = recorder()

  await continueLostTurn(turn([threadMessage('m1')]), deliver)

  expect(delivered).toEqual([])
})

test('a lost continuation is not continued again', async () => {
  attach(true, 'idle')
  const { delivered, deliver } = recorder()

  await continueLostTurn(turn([threadMessage('m1:continued')]), deliver)

  expect(delivered).toEqual([])
})

test('an app turn is left to the person who sent it', async () => {
  attach(true, 'idle')
  const { delivered, deliver } = recorder()

  await continueLostTurn(turn([appMessage]), deliver)

  expect(delivered).toEqual([])
})
