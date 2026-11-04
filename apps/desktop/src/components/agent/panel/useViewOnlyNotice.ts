import { useStableCallback } from '../../../hooks/useStableCallback'
import { openAddRuntime, openAgentSetup } from '../../../views/onboarding/setup/agentSetupStore'
import { useBoxAvailable } from '../../../views/settings/useAgentDevices'

import { viewOnlyNoticeFor } from './viewOnlyNotice'

import type { PanelViewCtx } from './ctx'

/** The open agent's way on for a viewer who can only read it. */
export function useViewOnlyNotice(c: PanelViewCtx) {
  const { activeTab, teamId, isTeamAdmin, runtimeInstances } = c
  // Only offered where a cloud computer can be made: this team's admins, on a plan that has them.
  const cloudOffered = useBoxAvailable() && isTeamAdmin && Boolean(teamId)
  const startChatOn = useStableCallback((runtimeId: string) => {
    c.selectConversationRuntime(runtimeId)
    c.startNewChat()
  })

  return viewOnlyNoticeFor(
    activeTab,
    runtimeInstances,
    startChatOn,
    openAgentSetup,
    cloudOffered && teamId ? () => openAddRuntime(teamId) : undefined,
  )
}
