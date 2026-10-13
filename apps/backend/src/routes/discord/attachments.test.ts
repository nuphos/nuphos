import { describe, expect, test } from 'bun:test'

import { INBOUND_FILE_FAILURE_NOTE } from '@/lib/agent/inbound-files'

import { ingestDiscordAttachments } from './attachments'
import { discordMessageText } from './message'

const scope = { teamId: '0123456789abcdef01234567', userId: 'user-1', sessionId: 'session-1' }

describe('Discord attachments', () => {
  test('adds nothing to a message without attachments', async () => {
    expect(await ingestDiscordAttachments({ ...scope, attachments: undefined })).toBe('')
    expect(await ingestDiscordAttachments({ ...scope, attachments: [] })).toBe('')
  })

  test('does not fetch a link outside the Discord CDN and says the file was unreadable', async () => {
    expect(
      await ingestDiscordAttachments({
        ...scope,
        attachments: [{ filename: 'notes.txt', url: 'http://169.254.169.254/latest/meta-data' }],
      }),
    ).toBe(INBOUND_FILE_FAILURE_NOTE)
  })
})

describe('Discord message text', () => {
  const event = (content: string, attachments = 0) => ({
    id: '1',
    channel_id: '2',
    content,
    attachments: Array.from({ length: attachments }, () => ({ filename: 'a.png', url: 'x' })),
  })

  test('strips the mention and keeps what was said', () => {
    expect(discordMessageText(event('<@42> what is this'), '42', false)).toBe('what is this')
  })

  test('lets a file stand in for a wordless message', () => {
    expect(discordMessageText(event('<@42>', 1), '42', false)).toBe('See the attached file(s).')
    expect(discordMessageText(event('<@42>'), '42', true)).toBe(
      'Please join the conversation using the thread context.',
    )
    expect(discordMessageText(event('<@42>'), '42', false)).toBe('')
  })
})
