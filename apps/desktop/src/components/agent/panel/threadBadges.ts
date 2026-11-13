import type { Part, ToolPart } from './parts.ts'

const THREAD_TOOLS = new Set(['create_thread', 'send_message_to_thread'])
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export type ThreadBadgeInfo = {
  threadId: string | null
  /** The title the agent gave a new thread; a messaged thread's comes from the server. */
  title: string | null
  verb: 'started' | 'messaged'
  pending: boolean
  /** The model a new thread was started on, when the agent chose one, and why. */
  model: string | null
  modelReason: string | null
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

// The receipt arrives as an object, as JSON text, or as MCP text content.
function receipt(output: unknown): Record<string, unknown> | null {
  if (typeof output === 'string') {
    try {
      return record(JSON.parse(output))
    } catch {
      return null
    }
  }
  if (Array.isArray(output)) {
    const text = output.find((item) => record(item)?.type === 'text') as
      { text?: unknown } | undefined

    return typeof text?.text === 'string' ? receipt(text.text) : null
  }

  return record(output)
}

function threadIdOf(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null
}

export function threadBadgeInfo(part: ToolPart): ThreadBadgeInfo | null {
  if (!THREAD_TOOLS.has(part.toolName) || part.state === 'output-error') return null
  const input = record(part.input)
  const pending = part.state !== 'output-available'
  const threadId = threadIdOf(input?.threadId) ?? threadIdOf(receipt(part.output)?.threadId)
  const title = nonEmpty(input?.title)
  const started = part.toolName === 'create_thread'

  // A finished call without a thread to open (an older transcript stored no
  // receipt) stays an ordinary tool row.
  if (!pending && !threadId) return null

  return {
    threadId,
    title,
    verb: started ? 'started' : 'messaged',
    pending,
    model: started ? nonEmpty(input?.model) : null,
    modelReason: started ? nonEmpty(input?.modelReason) : null,
  }
}

export function isThreadBadgePart(part: Part): boolean {
  return part.type === 'tool' && threadBadgeInfo(part) !== null
}

// Titles seen earlier in the transcript, for a later badge whose thread the
// viewer can no longer read.
const knownTitles = new Map<string, string>()

export function rememberThreadTitle(threadId: string | null, title: string | null) {
  if (threadId && title) knownTitles.set(threadId, title)
}

export function knownThreadTitle(threadId: string | null): string | null {
  return (threadId && knownTitles.get(threadId)) ?? null
}
