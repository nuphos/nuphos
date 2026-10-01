// The history preamble: what an existing conversation looked like before this
// turn, rendered as plain text for the first prompt of a freshly created inner
// session. Split out of preview-transcript.ts, which sits at the max-lines
// limit.
import { renderAttributedMessage } from '@/lib/agent/message-metadata'

import { backgroundWorkNotice } from './background-work'
import { steeringHistoryText } from './steering-receipt'

import type { UIMessage } from 'ai'

/**
 * One budget for the whole history preamble instead of a turn count. A turn
 * count only ever fitted the case this preamble was written for — a session
 * evicted mid-conversation, where the agent just needs to know what it was
 * doing. When the preamble is the *only* carrier (a conversation moved to
 * another agent, or a local session imported), dropping everything before the
 * last N turns silently loses the investigation. Newest turns are kept first,
 * so a long conversation still ends with the part that matters.
 */
const HISTORY_BUDGET_CHARS = 120_000
/** Per message, so one enormous turn cannot consume the whole budget. */
const HISTORY_PART_CHARS = 8_000

function partText(part: unknown): string | null {
  if (!part || typeof part !== 'object') return null
  const value = part as Record<string, unknown>

  if (value.type === 'text' && typeof value.text === 'string') return value.text
  if (value.type === 'data-steering' && value.data && typeof value.data === 'object')
    return steeringHistoryText(value.data as Record<string, unknown>)
  if (typeof value.type === 'string' && value.type.startsWith('tool-')) {
    const name = value.type.slice('tool-'.length)
    const input = value.input === undefined ? '' : ` ${JSON.stringify(value.input)}`

    return `[tool ${name}${input}]`
  }
  if (value.type === 'tool' && typeof value.toolName === 'string') {
    return `[tool ${value.toolName}]`
  }

  return null
}

/**
 * What an existing conversation looked like before this turn, for the first
 * prompt of a freshly created inner session — a pod replaced, a session
 * evicted, or the conversation deliberately moved to another agent: the
 * compaction summary when one exists, then as much of the conversation as
 * HISTORY_BUDGET_CHARS holds, newest first.
 */
export function previewHistoryPreamble(
  messages: UIMessage[],
  compactionSummary?: string | null,
  uncertain = false,
  inputCount = 1,
): string | null {
  const prior = messages
    .slice(0, messages.length - inputCount)
    .filter((m) => m.role === 'user' || m.role === 'assistant')

  if (prior.length === 0 && !compactionSummary) return null
  const lines: string[] = []
  let budget = HISTORY_BUDGET_CHARS

  // Newest first, then reversed: the tail is what the agent needs most, so it is
  // the part that survives a conversation too long to carry whole.
  for (let index = prior.length - 1; index >= 0; index--) {
    const message = prior[index]

    if (!message) continue
    const text = message.parts
      .map(partText)
      .filter((value): value is string => value !== null && value.trim() !== '')
      .join('\n')
      .slice(0, HISTORY_PART_CHARS)
    const line = `${message.role === 'user' ? 'User' : 'Assistant'}: ${renderAttributedMessage(message.id, text, message.metadata)}`

    if (line.length > budget) break
    budget -= line.length
    lines.unshift(line)
  }

  return [
    'This conversation continues from earlier turns your session no longer holds. Treat the following as your own prior context — do not summarize it back to the user.',
    backgroundWorkNotice(uncertain),
    ...(compactionSummary ? [`Summary of earlier turns:\n${compactionSummary}`] : []),
    ...(lines.length > 0 ? [`Recent turns:\n${lines.join('\n\n')}`] : []),
  ].join('\n\n')
}
