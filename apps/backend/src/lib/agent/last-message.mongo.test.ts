// A chat row previews the chat's newest post, stored the way a Bot's posts are, against a
// real MongoDB: the unit test store ignores sort, so only here does the order count.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { agentConversations, agentMessages, appendConversationMessages } from './db'
import { lastMessage } from './last-message'

const TEAM = new ObjectId().toHexString()
const OWNER = new ObjectId().toHexString()
const channel = { sessionId: `${TEAM}-chat`, userId: OWNER, teamId: TEAM, kind: 'channel' }

const post = (text: string, sender: { type: 'agent' | 'system'; id: string }) =>
  appendConversationMessages({
    ...channel,
    messages: [
      {
        id: new ObjectId().toHexString(),
        role: 'user',
        parts: [{ type: 'text', text }],
        metadata: {
          version: 1,
          sender: { ...sender, displayName: 'Bot' },
          source: sender.type === 'agent' ? 'agent.thread' : 'agent.resource',
          sentAt: new Date().toISOString(),
        },
      },
    ],
  })

describe.skipIf(!process.env.TEST_MONGODB_URI)('lastMessage', () => {
  beforeAll(async () => {
    await connectDb()
    await agentConversations().insertOne({
      ...channel,
      title: '',
      firstMessage: 'New chat',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    } as never)
  })

  afterAll(async () => {
    await agentMessages().deleteMany({ sessionId: channel.sessionId })
    await agentConversations().deleteMany({ teamId: TEAM })
    await closeDb()
  })

  test('a Bot that posts twice in one turn previews its second post', async () => {
    await post('First post', { type: 'agent', id: 'bot' })
    await post('Second post', { type: 'agent', id: 'bot' })
    // The turn goes on: a wake-up from the channel is not something anyone said.
    await post('New messages in a Nuphos channel', { type: 'system', id: 'channel:x' })

    expect(await lastMessage(channel, 'bot')).toEqual({ text: 'Second post' })
  })
})
