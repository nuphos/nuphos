import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { channelFacesField } from './channel-faces'
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
  kind: 'channel',
  title: 'Launch room',
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

describe('channelFacesField', () => {
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

    expect((await channelFacesField(channel, 'me', people)).faces).toEqual([
      { id: 'a2', name: 'Reviewer', agent: { avatar: 'a2-pick', provider: 'codex' } },
      { id: 'bob', name: 'Bob' },
    ])
  })

  test('a quiet chat shows its members in the order they joined', async () => {
    expect((await channelFacesField(channel, 'ann', people)).faces).toEqual([
      { id: 'a1', name: 'Writer', agent: { avatar: 'a1-pick', provider: 'codex' } },
      { id: 'a2', name: 'Reviewer', agent: { avatar: 'a2-pick', provider: 'codex' } },
    ])
  })

  test('a chat with one other member shows just them', async () => {
    const pair = { ...channel, participantIds: ['ann'], agentSessionIds: [] }

    expect((await channelFacesField(pair, 'me', people)).faces).toEqual([
      { id: 'ann', name: 'Ann', avatarURL: 'https://a/ann.png' },
    ])
  })

  test('a named chat keeps its name', async () => {
    expect(await channelFacesField(channel, 'me', people)).not.toHaveProperty('title')
  })

  test('an unnamed chat is called by everyone but the viewer', async () => {
    const unnamed = { ...channel, title: '' }

    expect((await channelFacesField(unnamed, 'me', people)).title).toBe(
      'Ann, Bob, Reviewer, Writer',
    )
    expect((await channelFacesField(unnamed, 'ann', people)).title).toBe(
      'Bob, Me, Reviewer, Writer',
    )
  })

  test('an unnamed chat with one other member is called by their name', async () => {
    const pair = { ...channel, title: '', participantIds: ['ann'], agentSessionIds: [] }

    expect((await channelFacesField(pair, 'me', people)).title).toBe('Ann')
    expect((await channelFacesField(pair, 'ann', people)).title).toBe('Me')
  })

  test('an unnamed chat with no one else is called by the viewer', async () => {
    const alone = { ...channel, title: '', participantIds: [], agentSessionIds: [] }

    expect((await channelFacesField(alone, 'me', people)).title).toBe('Me')
  })

  test('other conversations carry neither', async () => {
    expect(await channelFacesField({ ...channel, kind: undefined }, 'me', people)).toEqual({})
  })
})

describe('a single Bot keeps its chat identity when people reply', () => {
  beforeEach(async () => {
    memory = portabilityDb()
    await agentConversations().insertOne({
      sessionId: 'a1',
      userId: 'me',
      teamId: 'team',
      title: 'Writer',
      avatar: 'a1-pick',
      agentRuntime: 'codex',
    } as never)
  })

  test('keeps the Bot first even when two humans spoke more recently', async () => {
    await post(2, 'user', 'bob')
    await post(1, 'user', 'ann')
    await post(0, 'agent', 'a1')
    const shared = { ...channel, agentSessionIds: ['a1'] }

    expect((await channelFacesField(shared, 'me', people)).faces).toEqual([
      { id: 'a1', name: 'Writer', agent: { avatar: 'a1-pick', provider: 'codex' } },
      { id: 'bob', name: 'Bob' },
    ])
    expect((await channelFacesField({ ...shared, title: '' }, 'me', people)).title).toBe(
      'Ann, Bob, Writer',
    )
  })

  test('the collaborator also sees the Bot first when its owner replies', async () => {
    await post(1, 'user', 'me')
    await post(0, 'agent', 'a1')

    expect(
      (await channelFacesField({ ...channel, agentSessionIds: ['a1'] }, 'ann', people)).faces,
    ).toEqual([
      { id: 'a1', name: 'Writer', agent: { avatar: 'a1-pick', provider: 'codex' } },
      { id: 'me', name: 'Me', avatarURL: 'https://a/me.png' },
    ])
  })

  test('human-only groups still put the most recent speaker first', async () => {
    await post(1, 'user', 'bob')
    await post(0, 'user', 'ann')

    expect(
      (await channelFacesField({ ...channel, agentSessionIds: [] }, 'me', people)).faces,
    ).toEqual([
      { id: 'bob', name: 'Bob' },
      { id: 'ann', name: 'Ann', avatarURL: 'https://a/ann.png' },
    ])
  })
})
