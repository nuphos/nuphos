import type { Message } from './model'

/** Fewer turns than this fit on screen; the rail would only add noise. */
export const MIN_RAIL_TURNS = 4

const TITLE_MAX = 80
const PREVIEW_MAX = 240

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

/**
 * Inline markdown as the text a reader sees: links and images keep their
 * label, and emphasis, strike and code markers go. Underscores inside words
 * (snake_case) stay.
 */
export function plainInline(text: string): string {
  return text
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/!?\[([^[\]]*)\]/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~/g, '$1$2$3')
    .replace(/(?<![\w*])[*_]([^\s*_][^*_\n]*?)[*_](?![\w*])/g, '$1')
    .replace(/`+/g, '')
}

/** First non-empty line as plain text, without heading or list markers. */
export function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+|[-*>]\s+|\d+\.\s+)/, '').trim())
    .find(Boolean)

  return clip(plainInline(line ?? ''), TITLE_MAX)
}

// Even segments sit outside code fences; an unclosed fence drops its tail.
function withoutCodeBlocks(text: string): string {
  return text
    .split('```')
    .filter((_, i) => i % 2 === 0)
    .join(' ')
}

/** Assistant prose flattened to one line: no code blocks or markdown syntax. */
export function previewText(text: string): string {
  const flat = plainInline(withoutCodeBlocks(text))
    .replace(/^[ \t]*(?:#{1,6}|[-*>]|\d+\.)[ \t]+/gm, '')
    .replace(/[#>|]/g, '')
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

  // Only the start is shown, so a long reply is cut before its markdown is
  // stripped, but after its code blocks go: a cut inside a long block would
  // leave it unclosed and take the prose after it along.
  return previewText(
    withoutCodeBlocks(
      messages
        .filter((m) => replyIds.has(m.id))
        .map(messageText)
        .join(' '),
    ).slice(0, PREVIEW_MAX * 4),
  )
}
