// Tool calls that never count as "going off to work": instant, cosmetic, or
// meaningless as a step. slack_react's effect appears on the user's message
// itself; `skill` is setup noise (the desktop agent panel hides it for the
// same reason). Text around them keeps accumulating into one utterance, and
// they drive no status line.
export const CARDLESS_TOOLS = new Set(['slack_react', 'skill'])

// Status-line text while the model reasons. The reasoning stream carries no
// localized label (unlike tool calls), so this stays a fixed term-of-art.
export const REASONING_STATUS = 'Thinking'

// The status line sits on one row under the thread; a long tool label would be
// truncated by Slack anyway, and a short line reads as a status rather than a
// log entry.
export const STATUS_LINE_LIMIT = 80

// How much of the agent's own reply is kept for the thread transcript. Only
// the closing part is useful for judging a follow-up, and the full reply can
// be many KB.
export const REPLY_TAIL_CHARS = 1_200

export type SlackRunTerminal = 'complete' | 'paused' | 'error'

// The fence opener still in effect at the end of `text`, or null. CommonMark
// fences are a run of 3+ backticks OR tildes; a closer must use the same
// character, be at least as long, and carry nothing after it (the opener may
// carry an info string).
function openFenceAt(text: string): string | null {
  let open: string | null = null

  for (const line of text.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line)

    if (!match) continue
    const marker = match[1] ?? ''

    if (!open) {
      open = marker
      continue
    }
    const closes =
      marker.startsWith(open[0] ?? '') &&
      marker.length >= open.length &&
      !line.slice(match[0].length).trim()

    if (closes) open = null
  }

  return open
}

// Splits an utterance that exceeds Slack's per-message ceiling, cutting at
// paragraph/line/word boundaries when possible.
//
// Each chunk is converted to mrkdwn independently, so each one has to be a
// well-formed CommonMark document on its own. A cut landing inside a fenced
// code block used to leave the next chunk starting mid-code with no opening
// fence: it parsed as ordinary prose, and a `<@U…>` the author had safely
// inside a code block came back as a live Slack mention. So a split inside a
// fence closes it here and reopens it on the far side.
export function splitSlackText(text: string, limit = 3500): string[] {
  const chunks: string[] = []
  let remaining = text.trim()

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n\n', limit)

    if (cut < limit * 0.5) cut = remaining.lastIndexOf('\n', limit)
    if (cut < limit * 0.5) cut = remaining.lastIndexOf(' ', limit)
    if (cut < limit * 0.5) cut = limit
    let chunk = remaining.slice(0, cut).trim()
    let rest = remaining.slice(cut).trim()
    const openFence = rest ? openFenceAt(chunk) : null

    if (openFence) {
      chunk = `${chunk}\n${openFence}`
      rest = `${openFence}\n${rest}`
    }
    chunks.push(chunk)
    remaining = rest
  }
  if (remaining) chunks.push(remaining)

  return chunks
}

export function textDeltaFromPayload(payload: Record<string, unknown>): string {
  for (const key of ['delta', 'text', 'content', 'textDelta']) {
    const value = payload[key]

    if (typeof value === 'string' && value.length > 0) return value
  }

  return ''
}

export function labelFromToolInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const label = (input as { label?: unknown }).label

  return typeof label === 'string' && label.trim() ? label.trim() : undefined
}

// One-line status text: squash all whitespace so multi-line commands don't
// blow up the status row, clamped head-first (the start of a label/command is
// the informative part).
export function clampStatusText(text: string, limit = STATUS_LINE_LIMIT): string {
  const squashed = text.replace(/\s+/g, ' ').trim()

  return squashed.length > limit ? `${squashed.slice(0, limit - 1)}…` : squashed
}
