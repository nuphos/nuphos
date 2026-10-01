// Message-content text helpers shared by the journal panel and audit page.

/** Plain text of a message's parts (contentHot is the exact hashed parts array). */
export function journalContentText(contentHot: unknown): string {
  if (!Array.isArray(contentHot)) return ''

  return contentHot
    .map((part) => {
      if (typeof part !== 'object' || part === null) return ''
      const candidate = part as { type?: unknown; text?: unknown }

      return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

/** The model's reasoning parts — hashed with the rest of contentHot. */
export function journalReasoningText(contentHot: unknown): string {
  if (!Array.isArray(contentHot)) return ''

  return contentHot
    .map((part) => {
      if (typeof part !== 'object' || part === null) return ''
      const candidate = part as { type?: unknown; text?: unknown }

      return candidate.type === 'reasoning' && typeof candidate.text === 'string'
        ? candidate.text
        : ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Split an assistant turn's reasoning by the tool call it precedes.
 *
 * A multi-step thinking turn is one assistant message whose contentHot
 * interleaves reasoning with tool-call parts: `[reasoning, tool(A),
 * reasoning, tool(B), …, text]`. Rendering all of it under the single
 * assistant event divorces "why did the agent run THIS command" from the
 * command. This walks the parts and attributes each run of reasoning to the
 * NEXT tool call's id; reasoning after the last tool call (the pre-answer
 * thinking) is returned as `trailing`.
 */
export function reasoningByToolCall(contentHot: unknown): {
  byToolCall: Map<string, string>
  trailing: string
} {
  const byToolCall = new Map<string, string>()
  let pending: string[] = []

  if (!Array.isArray(contentHot)) return { byToolCall, trailing: '' }
  for (const part of contentHot) {
    if (typeof part !== 'object' || part === null) continue
    const p = part as { type?: unknown; text?: unknown; toolCallId?: unknown }

    if (p.type === 'reasoning' && typeof p.text === 'string') {
      if (p.text) pending.push(p.text)
    } else if (p.type === 'tool' && typeof p.toolCallId === 'string') {
      if (pending.length) {
        const prev = byToolCall.get(p.toolCallId)

        byToolCall.set(p.toolCallId, prev ? `${prev}\n${pending.join('\n')}` : pending.join('\n'))
      }
      pending = []
    }
  }

  return { byToolCall, trailing: pending.join('\n') }
}
