import { executeConversationTurn } from './conversation-turn'
import { authorizeThreadDelivery } from './thread-bridge'

import type { ThreadTurn } from './thread-bridge'

export async function executeThreadTurn(data: ThreadTurn): Promise<void> {
  const target = await authorizeThreadDelivery(data)

  await executeConversationTurn(data, target, data.prompt, 'agent.thread', {
    version: 1,
    sender: { type: 'agent', id: data.sessionId, displayName: 'Nuphos agent' },
    source: 'agent.thread',
    sourceSessionId: data.sessionId,
    sentAt: new Date().toISOString(),
  })
}
