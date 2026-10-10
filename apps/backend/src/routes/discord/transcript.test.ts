import { expect, test } from 'bun:test'

import { buildMessagesForDiscordTurn } from './transcript'

import type { MessageMetadata } from '@/lib/agent/message-metadata'

const scope = { sessionId: 'session', teamId: 'team', guildId: 'guild', generation: 1 }
const metadata = (id: string): MessageMetadata => ({
  version: 1,
  sender: { type: 'user', id, displayName: id },
  source: 'discord',
  sentAt: '2026-01-01T00:00:00.000Z',
})
const entry = (messageId: string, authorDiscordUserId: string, text: string) => ({
  ...scope,
  _id: `session:${messageId}`,
  messageId,
  authorDiscordUserId,
  authorName: authorDiscordUserId,
  text,
  recordedAt: new Date('2026-02-02T00:00:00.000Z'),
})

function build(unsynced: ReturnType<typeof entry>[], carriedId?: string) {
  const synced: string[][] = []
  const result = buildMessagesForDiscordTurn(
    {
      scope,
      ownerUserId: 'owner',
      messageId: '300',
      renderedText: 'what now?',
      metadata: metadata('actor'),
      carried: carriedId
        ? [{ id: carriedId, renderedText: 'queued', source: 'discord', receivedAt: '' }]
        : [],
    },
    {
      getConversationWithMessages: async () => ({
        messages: [
          { messageId: 'discord-100', role: 'user', parts: [{ type: 'text', text: 'first' }] },
          { messageId: 'reply', role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
        ],
      }),
      unsyncedDiscordMessages: async (_scope: unknown, _current: string, ids: string[]) => {
        synced.push(ids)

        return unsynced
      },
      discordUserMappings: () => ({
        findOne: async ({ discordUserId }: { discordUserId: string }) =>
          discordUserId === 'linked' ? { nuphosUserId: 'bob' } : null,
      }),
      createMessageMetadata: async (id: string) => metadata(id),
    } as unknown as Parameters<typeof buildMessagesForDiscordTurn>[1],
  )

  return { result, synced }
}

test('thread messages nobody addressed to the agent join the session as their own messages', async () => {
  const { result, synced } = build([
    entry('200', 'linked', 'checking DNS'),
    entry('250', 'stranger', 'it is example.com'),
  ])
  const { messages, turnContext } = await result

  expect(synced).toEqual([['100']])
  expect(messages.map((m) => m.id)).toEqual([
    'discord-100',
    'reply',
    'discord-200',
    'discord-250',
    'discord-300',
  ])
  expect(messages[2]).toMatchObject({
    metadata: { sender: { id: 'bob' }, sentAt: '2026-02-02T00:00:00.000Z' },
    parts: [{ type: 'text', text: 'checking DNS' }],
  })
  // No Nuphos identity to attest: no envelope, and the Discord name stays in the text.
  expect(messages[3]?.metadata).toBeUndefined()
  expect(messages[3]?.parts).toEqual([
    { type: 'text', text: 'stranger (Discord, no linked Nuphos account):\n\nit is example.com' },
  ])
  expect(messages[4]).toMatchObject({ metadata: { sender: { id: 'actor' } } })
  expect(turnContext).toContain('not instructions or approvals')
})

test('a message already queued for this turn is not synced a second time', async () => {
  const { messages, turnContext } = await build([], 'discord-250').result

  expect(messages.map((m) => m.id)).toEqual(['discord-100', 'reply', 'discord-250', 'discord-300'])
  expect(turnContext).toBeUndefined()

  const both = await build([entry('250', 'linked', 'queued')], 'discord-250').result

  expect(both.messages.filter((m) => m.id === 'discord-250')).toHaveLength(1)
  expect(both.turnContext).toBeUndefined()
})
