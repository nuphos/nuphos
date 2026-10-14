import type { Message } from './model'

/** Fewer turns than this fit on screen; the rail would only add noise. */
export const MIN_RAIL_TURNS = 4

const TITLE_MAX = 80
const PREVIEW_MAX = 180

export type RailTurn = {
  /** The user message id, also its `data-message-id` in the transcript. */
  id: string
  /** Ids of every message in the turn, user message first. */
  messageIds: string[]
  title: string
}

function messageText(message: Message): string {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** First non-empty line, without markdown heading or list markers. */
export function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+|[-*>]\s+|\d+\.\s+)/, '').trim())
    .find(Boolean)

  return clip(line ?? '', TITLE_MAX)
}

/** Assistant prose flattened to one line: no code blocks or markdown syntax. */
export function previewText(text: string): string {
  // Even segments sit outside code fences; an unclosed fence drops its tail.
  const flat = text
    .split('```')
    .filter((_, i) => i % 2 === 0)
    .join(' ')
    // Links and images keep their label: drop the "(url)" and the brackets.
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/!\[/g, '[')
    .replace(/[[\]`*_#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return clip(flat, PREVIEW_MAX)
}

/** One entry per user message, with the ids of the replies that follow it. */
export function pickRailTurns(messages: Message[]): RailTurn[] {
  const turns: RailTurn[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      const title =
        message.turnKind === 'plan-approval'
          ? 'Plan approval'
          : firstLine(messageText(message)) || 'Attachment'

      turns.push({ id: message.id, messageIds: [message.id], title })
      continue
    }
    turns.at(-1)?.messageIds.push(message.id)
  }

  return turns
}

/** Preview of one turn's replies; computed only for the hovered turn. */
export function turnPreview(messages: Message[], turn: RailTurn): string {
  const replyIds = new Set(turn.messageIds.slice(1))

  return previewText(
    messages
      .filter((m) => replyIds.has(m.id))
      .map(messageText)
      .join(' '),
  )
}
