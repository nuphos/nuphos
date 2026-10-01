// The "@Name says:" interop message a Nuphos-typed turn posts into its bound
// Slack thread: payload shape, truncation, and the plain-mrkdwn fallback when
// a workspace refuses the rich_text payload.
import { beforeEach, describe, expect, test } from 'bun:test'

import { useSlackApi } from '@/lib/test/doubles/slack-api'

type PostedMessage = {
  channel: string
  threadTs?: string
  text: string
  blocks?: unknown[]
}

const posted: PostedMessage[] = []
const state: { failBlocksWith: string | null } = { failBlocksWith: null }

useSlackApi({
  postSlackMessage: async (args: PostedMessage) => {
    if (args.blocks && state.failBlocksWith) {
      throw new Error(state.failBlocksWith)
    }
    posted.push(args)

    return { ok: true, ts: '1.1' }
  },
})

const { buildNuphosInteropBlocks, postNuphosInteropMessage } =
  await import('./slack/nuphos-interop')

beforeEach(() => {
  posted.length = 0
  state.failBlocksWith = null
})

function blockOfType(blocks: unknown[], type: string): Record<string, unknown> | undefined {
  return blocks.find((b) => (b as Record<string, unknown>).type === type) as
    Record<string, unknown> | undefined
}

describe('buildNuphosInteropBlocks', () => {
  test('renders bold @name, a literal quote of the question, and the app note', () => {
    const blocks = buildNuphosInteropBlocks({
      displayName: 'Patrick',
      question: 'Why is *this* pod <crashing>?',
    })
    const richText = blockOfType(blocks, 'rich_text')!
    const elements = richText.elements as Record<string, unknown>[]
    const section = elements.find((e) => e.type === 'rich_text_section')!
    const quote = elements.find((e) => e.type === 'rich_text_quote')!

    expect(section.elements).toEqual([
      { type: 'text', text: '@Patrick', style: { bold: true } },
      { type: 'text', text: ' says:' },
    ])
    // rich_text text elements are literal — user markup must survive verbatim.
    expect(quote.elements).toEqual([{ type: 'text', text: 'Why is *this* pod <crashing>?' }])
    const context = blockOfType(blocks, 'context')!

    expect(JSON.stringify(context)).toContain('Sent from the Nuphos app')
  })

  test('truncates long questions and points at the full message in Nuphos', () => {
    const blocks = buildNuphosInteropBlocks({ displayName: 'P', question: 'x'.repeat(5000) })
    const richText = blockOfType(blocks, 'rich_text')!
    const quote = (richText.elements as Record<string, unknown>[]).find(
      (e) => e.type === 'rich_text_quote',
    )!
    const quoteText = (quote.elements as { text: string }[])[0]!.text

    expect(quoteText.length).toBeLessThanOrEqual(2900)
    expect(JSON.stringify(blockOfType(blocks, 'context'))).toContain('Full message in Nuphos')
  })

  test('notes attachments and skips the quote for an attachment-only message', () => {
    const blocks = buildNuphosInteropBlocks({ displayName: 'P', question: '', attachmentCount: 2 })
    const richText = blockOfType(blocks, 'rich_text')!

    expect(
      (richText.elements as Record<string, unknown>[]).some((e) => e.type === 'rich_text_quote'),
    ).toBe(false)
    expect(JSON.stringify(blockOfType(blocks, 'context'))).toContain('2 attachments sent in Nuphos')
  })
})

describe('postNuphosInteropMessage', () => {
  test('posts the blocks into the thread with a plain notification text', async () => {
    await postNuphosInteropMessage({
      token: 'xoxb-1',
      channel: 'C1',
      threadTs: '100.1',
      displayName: 'Patrick',
      question: 'Scale the api deployment to 3 replicas',
    })

    expect(posted).toHaveLength(1)
    expect(posted[0]!.channel).toBe('C1')
    expect(posted[0]!.threadTs).toBe('100.1')
    expect(posted[0]!.blocks).toBeDefined()
    expect(posted[0]!.text).toBe('Patrick says: Scale the api deployment to 3 replicas')
  })

  test('falls back to escaped mrkdwn when the workspace refuses the blocks', async () => {
    state.failBlocksWith = 'Slack API error: invalid_blocks'
    await postNuphosInteropMessage({
      token: 'xoxb-1',
      channel: 'C1',
      threadTs: '100.1',
      displayName: 'Pat*rick',
      question: 'line one\nline <two>',
    })

    expect(posted).toHaveLength(1)
    expect(posted[0]!.blocks).toBeUndefined()
    expect(posted[0]!.text).toContain('says:')
    expect(posted[0]!.text).toContain('> line one')
    // User content is escaped; formatting chars in the name are dropped so
    // they cannot terminate the bold span early.
    expect(posted[0]!.text).toContain('&lt;two&gt;')
    expect(posted[0]!.text).toContain('*@Patrick* says:')
  })

  test('never throws when Slack is down — the turn must not fail on the mirror', async () => {
    state.failBlocksWith = 'Slack API error: channel_not_found'
    await postNuphosInteropMessage({
      token: 'xoxb-1',
      channel: 'C1',
      threadTs: '100.1',
      displayName: 'Patrick',
      question: 'hello',
    })

    // Not invalid_blocks → no fallback attempt either.
    expect(posted).toHaveLength(0)
  })
})
