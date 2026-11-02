import { assertNotChannel } from '@/lib/agent/db/channels'
import { fallBackBeforeTurn } from '@/lib/claude-code-preview/runtime-fallback'

import { assertConversationSendable, resolveReadableConversationForResume } from './team-scope'

import type { AgentChatBody } from './types'

/**
 * The conversation a chat post is for: the one to resume, or the one sent to,
 * moved down its owner's fallback list when its agent is unreachable. A channel
 * has no agent, so it is refused here, before any of the post is written.
 */
export async function resolveChatConversation(
  body: Pick<AgentChatBody, 'id' | 'resume'>,
  userId: string,
  teamId: Parameters<typeof assertConversationSendable>[2],
) {
  const conversation = body.resume
    ? await resolveReadableConversationForResume(body.id, userId, teamId)
    : await fallBackBeforeTurn(await assertConversationSendable(body.id, userId, teamId), userId)

  assertNotChannel(conversation)

  return conversation
}
