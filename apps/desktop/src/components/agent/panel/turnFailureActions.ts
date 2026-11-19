import { createContext } from 'react'

import { agentTier } from '../../../lib/agentName.ts'

import type { Tab } from './model.ts'
import type { CliLoginProvider } from '../../../api/device-types.ts'
import type { ThisComputer } from '../../../lib/agentName.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'
import type { ReactNode } from 'react'

type TurnSwitchAgent = {
  partId: string
  switchAgent: () => void
  /** Sets the failed runtime's team fallback, while it has none (useTurnFailureActions). */
  setUpFallback?: () => void
  /** That setup's dialog, drawn with the failure line. */
  fallbackDialog?: ReactNode
  /** This computer's agent whose CLI would not start: Settings' installer repairs it. */
  reinstall?: CliLoginProvider
}

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
  setUpFallback?: () => void,
): TurnSwitchAgent | null {
  const failed = latestFailure(tab)

  if (!failed || !tab?.sessionId || tab.readOnly || tab.foreign) return null

  return { partId: failed.id, switchAgent: openAgentMenu, setUpFallback }
}

/** The agent to reinstall from a failure line: a CLI that would not start, on this computer. */
export function reinstallProvider(
  cause: string | undefined,
  runtime: Pick<RuntimeInstance, 'id' | 'label' | 'local' | 'provider'> | undefined,
  thisComputer: ThisComputer,
): CliLoginProvider | undefined {
  if (cause !== 'cli' || !runtime || agentTier(runtime, thisComputer) !== 'local') return undefined

  return runtime.provider === 'codex' || runtime.provider === 'claude-code'
    ? runtime.provider
    : undefined
}

/** The failure line that ends the conversation, if its latest reply failed. */
export function latestFailure(tab: Pick<Tab, 'messages'> | null | undefined) {
  const reply = tab?.messages.at(-1)

  return reply?.role === 'assistant'
    ? reply.parts.findLast((part) => part.type === 'turn-interrupted')
    : undefined
}
