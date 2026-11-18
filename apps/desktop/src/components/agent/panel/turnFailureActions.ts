import { createContext } from 'react'

import type { Tab } from './model.ts'

type TurnSwitchAgent = { partId: string; switchAgent: () => void }

/** Switch runtime on the latest failure line; null where the viewer may not move the agent. */
export const TurnSwitchAgentContext = createContext<TurnSwitchAgent | null>(null)

/**
 * The latest turn's failure line, for whoever may move the conversation to another agent.
 * It opens the composer in its own panel: another composer for the session (a Bot's chat
 * under its open conversation) must stay closed.
 */
export function turnSwitchAgent(
  tab: Tab | null | undefined,
  openAgentMenu: () => void,
): TurnSwitchAgent | null {
  const reply = tab?.messages.at(-1)
  const failed =
    reply?.role === 'assistant'
      ? reply.parts.findLast((part) => part.type === 'turn-interrupted')
      : undefined

  if (!failed || !tab?.sessionId || tab.readOnly || tab.foreign) return null

  return { partId: failed.id, switchAgent: openAgentMenu }
}
