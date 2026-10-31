import { AgentSetupRequiredCard } from './AgentSetupRequiredCard'
import { lastSentText } from './agentSignInModel'

import type { Tab } from './model'

/** The sign-in card for a tab whose turn needs its agent signed in, wired from the tab. */
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
  if (!tab.agentSetupRequired) return null

  return (
    <AgentSetupRequiredCard
      teamId={teamId}
      runtimeId={tab.runtimeId}
      message={tab.agentSetupRequired.message}
      reason={tab.agentSetupRequired.reason}
      details={statusLabel}
      retryText={tab.readOnly || tab.foreign ? null : lastSentText(tab.messages)}
      isTeamAdmin={isTeamAdmin}
      onOpenAgentSettings={onOpenAgentSettings}
    />
  )
}
