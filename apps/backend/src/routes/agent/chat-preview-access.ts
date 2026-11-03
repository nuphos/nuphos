import { requeueTurnQueue } from '@/lib/agent/session-released'
import { previewSessionAccess } from '@/lib/claude-code-preview/credentials-mcp'

import type { PreparedPreviewTurn } from './chat-preview-prepare'
import type { PreviewChatTurnArgs } from './chat-preview-turn'

/**
 * This turn's MCP servers and runtime env. Minting the conversation token can
 * fail (for example a KMS outage) after the turn took its queue; nothing has
 * reached the runtime yet, so hand the carried inputs back and release the turn.
 * `release` drops this turn's other process-local state (its frame bridge).
 */
export async function previewTurnAccess(
  args: PreviewChatTurnArgs,
  prepared: PreparedPreviewTurn,
  release: () => void,
) {
  const { sessionId, teamId, userId } = args

  try {
    return await previewSessionAccess(sessionId, teamId, args.actorUserId ?? userId, userId, {
      ...args.endpoint,
      ...prepared.accessOptions,
    })
  } catch (err) {
    release()
    await requeueTurnQueue(userId, sessionId, prepared.carried, args.queued)
    await prepared.clearActiveTurn()
    throw err
  }
}
