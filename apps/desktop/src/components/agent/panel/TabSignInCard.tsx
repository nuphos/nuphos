import { AgentSetupRequiredCard } from './AgentSetupRequiredCard'
import { lastSentText } from './agentSignInModel'
import { useSignInRequest } from './signInAsks'

import type { Tab } from './model'

/**
 * The sign-in card for a tab whose turn needs its agent signed in, wired from the tab;
 * also for an open ask, which the people asked see without a failed turn of their own.
 */
export function TabSignInCard({
  tab,
  teamId,
  statusLabel,
  isTeamAdmin,
  onOpenAgentSettings,
}: {
  tab: Tab
  teamId?: string
  /** The runtime's own error line, which the card folds into Details. */
  statusLabel: string | null
  isTeamAdmin: boolean
  onOpenAgentSettings?: () => void
}) {
  const signInRequest = useSignInRequest(tab.sessionId, tab.signInRequest)

  if (!tab.agentSetupRequired && !(signInRequest && !tab.streaming)) return null

  return (
    <AgentSetupRequiredCard
      teamId={teamId}
      sessionId={tab.sessionId}
      runtimeId={tab.runtimeId}
      message={tab.agentSetupRequired?.message}
      reason={tab.agentSetupRequired?.reason}
      details={tab.agentSetupRequired ? statusLabel : null}
      signInRequest={signInRequest}
      messages={tab.messages}
      retryText={tab.readOnly || tab.foreign ? null : lastSentText(tab.messages)}
      isTeamAdmin={isTeamAdmin}
      onOpenAgentSettings={onOpenAgentSettings}
    />
  )
}
