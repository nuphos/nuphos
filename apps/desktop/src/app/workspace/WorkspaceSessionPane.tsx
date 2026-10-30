import { ChannelPane } from '../../components/channels/ChannelPane'
import { useIsChannel } from '../../components/channels/channelKind'

import { PaneGrip } from './PaneGrip'
import { WorkspaceAgentPane } from './WorkspaceAgentPane'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

/** The open session: a channel's own view, or the agent's session as before. */
export function WorkspaceSessionPane({
  ws,
  user,
  workspaceExpanded = false,
}: {
  ws: WorkspaceController
  user: UserInfo
  workspaceExpanded?: boolean
}) {
  const teamId = ws.scope?.teamId
  const sessionId = ws.selectedSessionId
  const channel = useIsChannel(teamId, sessionId)

  if (!channel || !teamId || !sessionId)
    return <WorkspaceAgentPane ws={ws} user={user} workspaceExpanded={workspaceExpanded} />

  return (
    <ChannelPane
      key={sessionId}
      teamId={teamId}
      channelId={sessionId}
      user={user}
      dockOpen={ws.dockOpen}
      grip={<PaneGrip />}
      onOpenSession={(agentId) => ws.workspaceActions.selectSession(agentId, { teamId })}
    />
  )
}
