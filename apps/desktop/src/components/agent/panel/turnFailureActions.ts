import { createContext } from 'react'

import { requestAgentMenu } from './agentMenuRequest.ts'

import type { Tab } from './model.ts'

type TurnSwitchAgent = { partId: string; switchAgent: () => void }

/** Switch runtime on the latest failure line; null where the viewer may not move the agent. */
export const TurnSwitchAgentContext = createContext<TurnSwitchAgent | null>(null)

/** The latest turn's failure line, for whoever may move the conversation to another agent. */
export function turnSwitchAgent(tab: Tab | null | undefined): TurnSwitchAgent | null {
  const reply = tab?.messages.at(-1)
  const failed =
    reply?.role === 'assistant'
      ? reply.parts.findLast((part) => part.type === 'turn-interrupted')
      : undefined
  const sessionId = tab?.sessionId

  if (!failed || !sessionId || tab.readOnly || tab.foreign) return null

  return { partId: failed.id, switchAgent: () => requestAgentMenu(sessionId) }
}
