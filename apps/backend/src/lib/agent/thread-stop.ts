import { stopConversationTurn } from '@/routes/agent/run-cancel'

import { getConversationBySessionId } from './db'
import { isChannel } from './db/channels'
import { authorizeThreadActor } from './thread-bridge'

import type { ThreadActor } from './thread-bridge'

/** Stop another owned conversation's running turn, as its own Stop does. */
export async function stopAgentThread(actor: ThreadActor, threadId: string) {
  await authorizeThreadActor(actor)
  if (threadId === actor.sessionId) throw new Error('Target must be another conversation.')
  const target = await getConversationBySessionId(threadId)

  if (!target || target.userId !== actor.userId || target.teamId !== actor.teamId) {
    throw new Error('Target must be a conversation you own in this team.')
  }
  if (isChannel(target)) throw new Error('A channel has no agent of its own to stop.')
  const stopped = await stopConversationTurn(target)

  return {
    threadId,
    status: stopped ? 'stopped' : 'idle',
    ...(stopped ? {} : { note: 'No turn was running, so nothing was stopped.' }),
    _links: { web: `/teams/${actor.teamId}/agent/${threadId}` },
  }
}
