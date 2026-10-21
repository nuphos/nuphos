import { redactSignedTokens } from './mcp-token'

import type { OpenAbSessionUpdate } from './openab-acp-updates'

// How every token this backend signs begins.
const TOKEN_STARTS = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.', // b64url of the fixed HS256 JWT header
  'nuphos-runtime-skills-v1.',
]
const SEPARATORS = new Set([' ', '\n', '\r', '\t', '"', "'", '\\'])

/** Where an unfinished token may begin at the end of `text`; text.length when none. */
function pendingTokenStart(text: string): number {
  let run = text.length

  while (run > 0 && !SEPARATORS.has(text[run - 1] ?? ' ')) run--
  const tail = text.slice(run)
  const starts = TOKEN_STARTS.flatMap((start) => {
    const inside = tail.indexOf(start.slice(0, 3))

    if (inside >= 0) return [run + inside]
    // The run ends partway into a token's fixed beginning.
    for (let at = 0; at < tail.length - 1; at++)
      if (start.startsWith(tail.slice(at))) return [run + at]

    return []
  })

  return Math.min(text.length, ...starts)
}

function heldBack(emit: (text: string) => void) {
  // The last character already sent: a token split right after it still matches.
  let sent = ''
  let held = ''

  return {
    push(text: string) {
      const all = redactSignedTokens(sent + held + text)
      const fresh = all.startsWith(sent) ? all.slice(sent.length) : all
      const context = all.startsWith(sent) ? sent : ''
      const cut = Math.max(0, pendingTokenStart(context + fresh) - context.length)

      held = fresh.slice(cut)
      if (cut > 0) {
        emit(fresh.slice(0, cut))
        sent = fresh.slice(cut - 1, cut)
      }
    },
    flush() {
      const rest = held

      held = ''
      if (rest) emit(redactSignedTokens(rest))
    },
  }
}

// A completion, an interruption, or the runtime thread leaving `active`.
const turnEnds = (update: OpenAbSessionUpdate) =>
  update.kind === 'complete' ||
  update.kind === 'interrupted' ||
  (update.kind === 'status' && update.status !== 'active')

/**
 * Wraps a session-update handler so streamed agent text and thoughts never
 * carry a backend token, even one split across chunks. Only text that may
 * begin a token is held, and it stays held across other updates until the
 * token resolves, the turn ends, or flush() is called.
 */
export function redactStreamedUpdates(handler: (update: OpenAbSessionUpdate) => void) {
  const text = heldBack((value) => {
    handler({ kind: 'text', text: value })
  })
  const thought = heldBack((value) => {
    handler({ kind: 'agent', update: { kind: 'thought', text: value } })
  })
  const flush = () => {
    text.flush()
    thought.flush()
  }

  return {
    deliver: (update: OpenAbSessionUpdate) => {
      if (update.kind === 'text') text.push(update.text)
      else if (update.kind === 'agent' && update.update.kind === 'thought')
        thought.push(update.update.text)
      else {
        if (turnEnds(update)) flush()
        handler(update)
      }
    },
    flush,
  }
}
