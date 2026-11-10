import { createContext, useMemo } from 'react'

import { useStableCallback } from '../../../hooks/useStableCallback'
import { runtimeIsExecuting } from '../../../lib/runtimeExecution'

import { failedTurn } from './turnRetry'

import type { Tab } from './model'
import type { AgentMessageMention } from '../../../api/agent-types'

type TurnRetry = { partId: string; retry: () => void }

/** Resends the latest failed turn's prompt; null where there is nothing the viewer may resend. */
export const TurnRetryContext = createContext<TurnRetry | null>(null)

/** Retry for the active tab's latest failed turn, while the viewer may send and nothing runs. */
export function useFailedTurnRetry(
  tab: Tab | null | undefined,
  currentUserId: string | undefined,
  foreignChat: boolean,
  send: (
    text: string,
    attachments: string[],
    turnKind?: undefined,
    replyTo?: undefined,
    mentions?: AgentMessageMention[],
  ) => void,
): TurnRetry | null {
  const messages = tab?.messages
  const failed = useMemo(
    () => failedTurn(messages ?? [], currentUserId, foreignChat),
    [messages, currentUserId, foreignChat],
  )
  const retry = useStableCallback(() => {
    if (failed) send(failed.prompt, [], undefined, undefined, failed.mentions)
  })
  const value = useMemo(() => (failed ? { partId: failed.partId, retry } : null), [failed, retry])
  const idle = tab && !tab.readOnly && !tab.streaming && !runtimeIsExecuting(tab.runtimeState)

  return idle ? value : null
}
