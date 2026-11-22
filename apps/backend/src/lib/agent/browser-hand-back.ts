// A person closes a browser window an agent put on their screen (local_browser
// show): they hand the browser back, and the agent is woken to carry on, as an
// answer to its question wakes it. It reads the page itself to see how far they got.
import { randomUUID } from 'node:crypto'

import { logError } from '@/lib/observability'

import { systemSender } from './message-metadata'

import type { AgentConversation } from './db'

const SENDER = 'nuphos:browser'

/** The wake event's body: which tab, and what to do with it. */
export const handBackNotice = (tab: number) =>
  `The person closed the browser window you showed them (tab ${String(tab)}), handing the browser back. ` +
  'Read the page to see what they did there, then continue the task. If you were not waiting on them there, end your turn without a reply.'

/** Wakes the conversation with the notice, or queues it behind the turn that runs. */
export async function wakeOnHandBack(
  conversation: AgentConversation,
  teamId: string,
  tab: number,
): Promise<void> {
  const { startConversationTurn } = await import('./conversation-turn')
  const { run } = await startConversationTurn(
    {
      userId: conversation.userId,
      teamId,
      targetSessionId: conversation.sessionId,
      messageId: randomUUID(),
      locale: conversation.metadata?.locale ?? 'en-US',
    },
    conversation,
    handBackNotice(tab),
    'agent.resource',
    systemSender(SENDER, 'Nuphos'),
  )

  run.catch((error: unknown) => {
    logError('agent.browser.hand_back_turn_failed', error, {
      session_id: conversation.sessionId,
    })
  })
}
