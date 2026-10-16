import { consumeConversationRetracted } from '@/lib/agent/db'

import type { TeamSession } from './team-openab-runtime'

/**
 * A stopped prompt stays in the runtime's own session history even after it
 * leaves the transcript, so the next prompt in that session says to drop it.
 */
export const RETRACTED_NOTICE =
  'The user took back their previous message before you answered it, and that turn was ' +
  'stopped. Disregard that message: do not act on it or refer to it.'

/** The notice once after a retraction; a fresh session rebuilt from the transcript never saw it. */
export async function retractedPrompt(session: TeamSession, fresh: boolean): Promise<string> {
  const retracted = await consumeConversationRetracted(session.conversationId, session.teamId)

  return retracted && !fresh ? RETRACTED_NOTICE : ''
}
