import type { PreviewAgentUpdate, PreviewTextMetadata } from './preview-agent-update'

type ChunkUpdate =
  | ({ kind: 'text'; text: string } & PreviewTextMetadata)
  | { kind: 'agent'; update: PreviewAgentUpdate }

export function chunkUpdate(kind: unknown, payload: Record<string, unknown>): ChunkUpdate | null {
  const content = payload.content

  if (!content || typeof content !== 'object') return null
  const text = (content as Record<string, unknown>).text

  if (typeof text !== 'string' || text.length === 0) return null

  if (kind !== 'agent_message_chunk') return { kind: 'agent', update: { kind: 'thought', text } }
  const meta = payload._meta as { codex?: { phase?: unknown } } | undefined
  const phase = meta?.codex?.phase

  return {
    kind: 'text',
    text,
    ...(typeof payload.messageId === 'string' && payload.messageId
      ? { messageId: payload.messageId }
      : {}),
    ...(phase === 'commentary' || phase === 'final_answer' ? { phase } : {}),
  }
}
