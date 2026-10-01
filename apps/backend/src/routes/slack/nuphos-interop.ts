import { logEvent } from '@/lib/observability'
import { postSlackMessage } from '@/lib/slack/api'
import { escapeSlackMrkdwn } from '@/lib/slack/mrkdwn'
import { truncatePlain } from '@/routes/slack/shared'

// Slack rejects text elements past ~3000 chars; stay under it so the quote
// block never trips invalid_blocks on its own. The full message lives in the
// Nuphos transcript, which the truncation note points at.
const INTEROP_QUOTE_MAX = 2900

type NuphosInteropArgs = {
  displayName: string
  question: string
  attachmentCount?: number
}

// The "@Name says:" line + quoted question a Nuphos-typed turn posts into the
// bound Slack thread before the agent's mirrored reply. rich_text is used
// because rich_text_quote is Slack's native quote rendering and its text
// elements are literal — user-typed content needs no mrkdwn escaping.
export function buildNuphosInteropBlocks(args: NuphosInteropArgs): unknown[] {
  const question = args.question.trim()
  const quoted = truncatePlain(question, INTEROP_QUOTE_MAX)
  const contextNotes = [
    'Sent from the Nuphos app',
    ...(quoted.length < question.length ? ['Full message in Nuphos'] : []),
    ...(args.attachmentCount
      ? [
          `${String(args.attachmentCount)} attachment${args.attachmentCount === 1 ? '' : 's'} sent in Nuphos`,
        ]
      : []),
  ]

  return [
    {
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            { type: 'text', text: `@${args.displayName}`, style: { bold: true } },
            { type: 'text', text: ' says:' },
          ],
        },
        ...(quoted
          ? [{ type: 'rich_text_quote', elements: [{ type: 'text', text: quoted }] }]
          : []),
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: contextNotes.join(' · ') }],
    },
  ]
}

// Plain-mrkdwn rendering of the same message, for clients/workspaces where the
// rich_text payload is refused (invalid_blocks) — and the notification line.
// mrkdwn has no escape for its formatting characters, so the name inside the
// bold span drops them instead (a `*` in a display name would end the bold
// early); injection characters (&, <, >) are escaped as usual.
function interopFallbackText(args: NuphosInteropArgs): string {
  const name = escapeSlackMrkdwn(args.displayName.replace(/[*_~`]/g, '')) || 'A teammate'
  const quoted = truncatePlain(args.question, INTEROP_QUOTE_MAX)
  const quoteLines = quoted
    ? quoted
        .split('\n')
        .map((line) => `> ${escapeSlackMrkdwn(line)}`)
        .join('\n')
    : ''

  return [`*@${name}* says:`, ...(quoteLines ? [quoteLines] : [])]
    .join('\n')
    .concat('\n_Sent from the Nuphos app_')
}

/**
 * Post the interop message into the bound thread. Never throws: Slack delivery
 * is best-effort by contract (see lib/slack/stream-sink.ts) — a failed mirror
 * must not fail the Nuphos turn, so failures are logged and swallowed.
 */
export async function postNuphosInteropMessage(
  args: NuphosInteropArgs & { token: string; channel: string; threadTs: string },
): Promise<void> {
  const notification = truncatePlain(`${args.displayName} says: ${args.question}`, 200)

  try {
    await postSlackMessage({
      token: args.token,
      channel: args.channel,
      threadTs: args.threadTs,
      text: notification || `${args.displayName} says:`,
      blocks: buildNuphosInteropBlocks(args),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    if (message.includes('invalid_blocks')) {
      try {
        await postSlackMessage({
          token: args.token,
          channel: args.channel,
          threadTs: args.threadTs,
          text: interopFallbackText(args),
        })

        return
      } catch (fallbackErr) {
        logEvent('warn', 'slack.nuphos_interop.post_failed', {
          slack_channel_id: args.channel,
          slack_thread_ts: args.threadTs,
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        })

        return
      }
    }
    logEvent('warn', 'slack.nuphos_interop.post_failed', {
      slack_channel_id: args.channel,
      slack_thread_ts: args.threadTs,
      error: message,
    })
  }
}
