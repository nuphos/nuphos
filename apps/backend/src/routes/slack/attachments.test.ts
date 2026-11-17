import { describe, expect, test } from 'bun:test'

import { useSlackApi } from '@/lib/test/doubles/slack-api'

const downloads: string[] = []

useSlackApi({
  downloadSlackFile: async (args: Record<string, unknown>) => {
    downloads.push(String(args.urlPrivate))
    const size = Number(/size=(\d+)/u.exec(String(args.urlPrivate))?.[1])

    return size && size <= Number(args.maxBytes)
      ? { bytes: new Uint8Array(size), contentType: 'image/png' }
      : null
  },
  slackApi: async () => ({ ok: true }),
  slackApiGet: async () => ({ ok: true }),
})

const { ingestSlackAttachments, placeSlackHistoryFiles } =
  await import('@/routes/slack/attachments')

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
    })

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

describe('placeSlackHistoryFiles', () => {
  const place = (files: { fileName: string }[]) =>
    Promise.resolve(files.map((file) => `/work/attachments/${file.fileName}`))

  test('lists a local path for each fetched file and drops the Slack URLs', async () => {
    const plain = { ts: '1.1', text: 'no files here' }
    const [first, second] = await placeSlackHistoryFiles(
      'xoxb-1',
      [
        plain,
        {
          ts: '2.1',
          text: 'see screenshot',
          files: [
            {
              id: 'F1',
              name: 'shot.png',
              url_private: 'https://files.slack.com/shot.png?size=10',
              url_private_download: 'https://files.slack.com/download/shot.png',
            },
          ],
        },
      ],
      place,
    )

    expect(first).toBe(plain)
    expect(second).toEqual({
      ts: '2.1',
      text: 'see screenshot',
      files: [{ id: 'F1', name: 'shot.png', path: '/work/attachments/shot.png' }],
    })
  })

  test('says why a file is missing instead of failing the page', async () => {
    const [message] = await placeSlackHistoryFiles(
      'xoxb-1',
      [
        {
          ts: '2.1',
          files: [
            { id: 'F1', name: 'hidden.pdf', file_access: 'check_file_info' },
            { id: 'F2', name: 'gone.pdf', url_private: 'https://files.slack.com/gone.pdf' },
            { id: 'F3', name: 'ok.png', url_private: 'https://files.slack.com/ok.png?size=10' },
          ],
        },
      ],
      place,
    )

    expect(message!.files).toEqual([
      { id: 'F1', name: 'hidden.pdf', error: 'Slack did not share this file with the Nuphos app.' },
      { id: 'F2', name: 'gone.pdf', error: 'Could not be fetched, or is too large.' },
      { id: 'F3', name: 'ok.png', path: '/work/attachments/ok.png' },
    ])
  })

  test('stops fetching at the per-call file limit', async () => {
    downloads.length = 0
    const files = Array.from({ length: 12 }, (_, index) => ({
      id: `F${String(index)}`,
      name: `${String(index)}.png`,
      url_private: `https://files.slack.com/${String(index)}.png?size=10`,
    }))
    const [message] = await placeSlackHistoryFiles('xoxb-1', [{ ts: '2.1', files }], place)
    const listed = message!.files as { path?: string; error?: string }[]

    expect(downloads).toHaveLength(10)
    expect(listed.filter((file) => file.path)).toHaveLength(10)
    expect(listed[11]!.error).toContain('file limit')
  })

  test('a file larger than what is left of the byte budget is not buffered', async () => {
    const big = 20 * 1024 * 1024
    const [message] = await placeSlackHistoryFiles(
      'xoxb-1',
      [
        {
          ts: '2.1',
          files: ['a', 'b', 'c'].map((name) => ({
            id: name,
            name: `${name}.bin`,
            url_private: `https://files.slack.com/${name}.bin?size=${String(big)}`,
          })),
        },
      ],
      place,
    )
    const listed = message!.files as { path?: string; error?: string }[]

    expect(listed.map((file) => Boolean(file.path))).toEqual([true, true, false])
  })

  test('a runtime that cannot take the files reports that on each of them', async () => {
    const [message] = await placeSlackHistoryFiles(
      'xoxb-1',
      [
        {
          ts: '2.1',
          files: [
            { id: 'F1', name: 'a.png', url_private: 'https://files.slack.com/a.png?size=10' },
          ],
        },
      ],
      () => Promise.reject(new Error('This conversation has no running agent')),
    )

    expect(message!.files).toEqual([
      { id: 'F1', name: 'a.png', error: 'This conversation has no running agent' },
    ])
  })
})
