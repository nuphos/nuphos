import { createContext } from 'react'

import { requestAgentMenu } from './agentMenuRequest.ts'

import type { Tab } from './model.ts'

type TurnSwitchAgent = { partId: string; switchAgent: () => void; setUpFallback?: () => void }

/** Switch runtime on the latest failure line; null where the viewer may not move the agent. */
export const TurnSwitchAgentContext = createContext<TurnSwitchAgent | null>(null)

/** The failure line that ends the conversation, if its latest reply failed. */
export function latestFailure(tab: Pick<Tab, 'messages'> | null | undefined) {
  const reply = tab?.messages.at(-1)

  return reply?.role === 'assistant'
    ? reply.parts.findLast((part) => part.type === 'turn-interrupted')
    : undefined
}

/** The latest turn's failure line, for whoever may move the conversation to another agent. */
export function turnSwitchAgent(
  tab: Tab | null | undefined,
  setUpFallback?: () => void,
): TurnSwitchAgent | null {
  const failed = latestFailure(tab)
  const sessionId = tab?.sessionId

  if (!failed || !sessionId || tab.readOnly || tab.foreign) return null

  return { partId: failed.id, switchAgent: () => requestAgentMenu(sessionId), setUpFallback }
}
