import type { AgentConversation } from '@/lib/agent/db'

/**
 * Whether a transcript PUT is an import, which may write a native runtime's
 * history. The first chunk creates the conversation. A long history comes in
 * chunks to stay under the ingress body limit, so the owner may keep appending
 * while each chunk starts where the stored history ends and nothing but the
 * import has written to the conversation yet (no turn, no runtime attachment).
 */
export function isTranscriptImport(
  requested: boolean,
  existing: AgentConversation | null,
  userId: string,
  baseIndex: number,
): boolean {
  if (!requested) return false
  if (!existing) return true

  return (
    existing.userId === userId &&
    baseIndex > 0 &&
    baseIndex === existing.messageCount &&
    !existing.activitySeq &&
    !existing.claudeCodePreview
  )
}
