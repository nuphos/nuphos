// The rolling transcript is what the addressing judge reads; clipping happens
// at WRITE time, so a head-only cut here would lose the agent's tail question
// forever no matter how the prompt renders it.
import { describe, expect, test } from 'bun:test'

import {
  TRANSCRIPT_BOT_MESSAGE_CHARS,
  TRANSCRIPT_MESSAGE_CHARS,
} from '@/lib/agent/thread-addressing-core'
import { useDb } from '@/lib/test/doubles/db'

import type { SlackThreadMessageRecord } from '@/lib/slack/agent-bot/collections'

type PushUpdate = {
  $push: { recentMessages: { $each: SlackThreadMessageRecord[]; $slice: number } }
}

const updates: PushUpdate[] = []
const inserted: { recentMessages?: SlackThreadMessageRecord[] }[] = []

useDb({
  db: () => ({
    collection: () => ({
      updateOne: (_filter: unknown, update: PushUpdate) => {
        updates.push(update)

        return Promise.resolve({ matchedCount: 1 })
      },
      findOne: () => Promise.resolve(null),
      insertOne: (doc: { recentMessages?: SlackThreadMessageRecord[] }) => {
        inserted.push(doc)

        return Promise.resolve({ insertedId: 'id' })
      },
    }),
  }),
})

const { appendSlackThreadMessage } = await import('./threads')
const { bindSlackAgentThread } = await import('./thread-binding')

const KEY = { slackWorkspaceId: 'T1', slackChannelId: 'C1', slackThreadTs: '1.0' }

function lastStoredText(): string {
  const update = updates.at(-1)

  if (!update) throw new Error('no updateOne recorded')

  return update.$push.recentMessages.$each[0]?.text ?? ''
}

describe('appendSlackThreadMessage clipping', () => {
  test('an over-long bot message keeps its tail, at the bot budget', async () => {
    const text = `${'report line '.repeat(200)}Do you want me to apply the fix?`

    await appendSlackThreadMessage(KEY, {
      ts: '2.0',
      authorName: 'Nuphos',
      text,
      fromBot: true,
    })

    const stored = lastStoredText()

    expect(stored.endsWith('Do you want me to apply the fix?')).toBe(true)
    expect(stored.startsWith('report line')).toBe(true)
    expect(stored).toHaveLength(TRANSCRIPT_BOT_MESSAGE_CHARS)
  })

  test('an over-long human message keeps both ends within the smaller budget', async () => {
    await appendSlackThreadMessage(KEY, {
      ts: '3.0',
      authorName: 'Yuan',
      text: `HEAD ${'x'.repeat(2_000)} TAIL`,
    })

    const stored = lastStoredText()

    expect(stored.startsWith('HEAD')).toBe(true)
    expect(stored.endsWith('TAIL')).toBe(true)
    expect(stored).toHaveLength(TRANSCRIPT_MESSAGE_CHARS)
  })

  test('a short message is stored as-is', async () => {
    await appendSlackThreadMessage(KEY, { ts: '4.0', authorName: 'Yuan', text: '要' })

    expect(lastStoredText()).toBe('要')
  })
})

describe('bindSlackAgentThread rootText seed clipping', () => {
  test('the seeded root notification keeps its tail, at the bot budget', async () => {
    await bindSlackAgentThread({
      ...KEY,
      teamId: 'team',
      agentUserId: 'agent',
      sessionId: 'sess',
      rootText: `${'alert detail '.repeat(200)}Reply here to investigate.`,
    })

    const seeded = inserted.at(-1)?.recentMessages?.[0]?.text ?? ''

    expect(seeded.endsWith('Reply here to investigate.')).toBe(true)
    expect(seeded).toHaveLength(TRANSCRIPT_BOT_MESSAGE_CHARS)
  })
})
