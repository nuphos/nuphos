import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { channelFaces } from './channel-faces'
import { agentConversations, agentMessages } from './db'

import type { AgentConversation } from './db'
import type * as dbActual from '@/lib/db'

let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })

const people = new Map([
  ['me', { id: 'me', name: 'Me', avatarURL: 'https://a/me.png' }],
  ['ann', { id: 'ann', name: 'Ann', avatarURL: 'https://a/ann.png' }],
  ['bob', { id: 'bob', name: 'Bob' }],
])

const channel = {
  sessionId: 'chat',
  userId: 'me',
  teamId: 'team',
  participantIds: ['ann', 'bob'],
  agentSessionIds: ['a1', 'a2'],
} as AgentConversation

async function post(index: number, type: 'user' | 'agent', id: string) {
  await agentMessages().insertOne({
    sessionId: 'chat',
    userId: 'me',
    index,
    metadata: {
      version: 1,
      sender: { type, id, displayName: id },
      source: type === 'user' ? 'nuphos' : 'agent.thread',
      ...(type === 'agent' ? { sourceSessionId: id } : {}),
      sentAt: new Date().toISOString(),
    },
  } as never)
}

describe('channelFaces', () => {
  beforeEach(async () => {
    memory = portabilityDb()
    for (const [sessionId, title] of [
      ['a1', 'Writer'],
      ['a2', 'Reviewer'],
    ])
      await agentConversations().insertOne({
        sessionId,
        userId: 'me',
        teamId: 'team',
        title,
        avatar: `${sessionId}-pick`,
        agentRuntime: 'codex',
      } as never)
  })

  test('shows two others, whoever spoke last first, never the viewer', async () => {
    // The test store ignores sort, so posts go in newest first.
    await post(2, 'user', 'me')
    await post(1, 'agent', 'a2')
    await post(0, 'user', 'bob')

    expect(await channelFaces(channel, 'me', people)).toEqual([
      { id: 'a2', name: 'Reviewer', agent: { avatar: 'a2-pick', provider: 'codex' } },
      { id: 'bob', name: 'Bob' },
    ])
  })

  test('a quiet chat shows its members in the order they joined', async () => {
    expect(await channelFaces(channel, 'ann', people)).toEqual([
      { id: 'a1', name: 'Writer', agent: { avatar: 'a1-pick', provider: 'codex' } },
      { id: 'a2', name: 'Reviewer', agent: { avatar: 'a2-pick', provider: 'codex' } },
    ])
  })

  test('a chat with one other member shows just them', async () => {
    const pair = { ...channel, participantIds: ['ann'], agentSessionIds: [] }

    expect(await channelFaces(pair, 'me', people)).toEqual([
      { id: 'ann', name: 'Ann', avatarURL: 'https://a/ann.png' },
    ])
  })
})
