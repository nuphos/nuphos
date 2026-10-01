import { describe, expect, test } from 'bun:test'

import { useSlackApi } from '@/lib/test/doubles/slack-api'

const downloads: string[] = []

useSlackApi({
  downloadSlackFile: async (args: Record<string, unknown>) => {
    downloads.push(String(args.urlPrivate))

    return null
  },
  slackApi: async () => ({ ok: true }),
  slackApiGet: async () => ({ ok: true }),
})

const { ingestSlackAttachments } = await import('@/routes/slack/attachments')

const BASE = {
  runtime: { botToken: 'xoxb-1' },
  teamId: '6a6aec7f663728334ea059c4',
  userId: '6a6aec7f663728334ea059c5',
  sessionId: 's1',
} as unknown as Parameters<typeof ingestSlackAttachments>[0]

function withFiles(files: unknown[]) {
  return { ...BASE, event: { channel: 'C1', files } } as Parameters<
    typeof ingestSlackAttachments
  >[0]
}

describe('ingestSlackAttachments', () => {
  test('says nothing when the message carried no files at all', async () => {
    const result = await ingestSlackAttachments({
      ...BASE,
      event: { channel: 'C1' },
    } as Parameters<typeof ingestSlackAttachments>[0])

    expect(result).toEqual({ note: '', parts: [] })
  })

  // Slack omits url_private from the file object when the bot token lacks
  // files:read — the workspace installed before that scope existed. The old
  // early return made that indistinguishable from "no attachment", so the
  // agent saw a message with no text and no explanation and could not even
  // tell the user it had missed something.
  test('reports a failure when files were attached but none are fetchable', async () => {
    const result = await ingestSlackAttachments(
      withFiles([{ id: 'F1', name: 'spec.pdf', file_access: 'check_file_info' }]),
    )

    expect(result.parts).toEqual([])
    expect(result.note).toContain('could not be read')
    expect(downloads).toHaveLength(0)
  })

  test('reports a failure when the download itself fails', async () => {
    downloads.length = 0
    const result = await ingestSlackAttachments(
      withFiles([{ id: 'F1', name: 'spec.pdf', url_private: 'https://files.slack.com/spec.pdf' }]),
    )

    expect(downloads).toHaveLength(1)
    expect(result.note).toContain('could not be read')
  })

  test('a partially unreadable batch still reports the failure', async () => {
    downloads.length = 0
    const result = await ingestSlackAttachments(
      withFiles([
        { id: 'F1', name: 'a.pdf', file_access: 'check_file_info' },
        { id: 'F2', name: 'b.pdf', url_private: 'https://files.slack.com/b.pdf' },
      ]),
    )

    expect(result.note).toContain('could not be read')
  })
})
