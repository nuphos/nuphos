import { clsx } from 'clsx'

import { useIsChannel } from '../../components/channels/channelKind'
import { ChannelPane } from '../../components/channels/ChannelPane'

import { CORNER_TITLEBAR_CLASS, CornerSidebarToggle } from './CornerSidebarToggle'
import { PaneGrip } from './PaneGrip'
import { WorkspaceAgentPane } from './WorkspaceAgentPane'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

/** The open session: a channel's own view, or the agent's session as before. */
export function WorkspaceSessionPane({
  ws,
  user,
  workspaceExpanded = false,
  onOpenTask,
}: {
  ws: WorkspaceController
  user: UserInfo
  workspaceExpanded?: boolean
  onOpenTask?: (sessionId: string) => void
}) {
  const teamId = ws.scope?.teamId
  const sessionId = ws.selectedSessionId
  const channel = useIsChannel(teamId, sessionId)
  const cornerPane = useWorkspacePane()?.cornerPane ?? false

  // Still checking: neither view, so a channel never opens as an agent first.
  if (channel === undefined) return <div className="min-w-0 flex-1" />
  if (!channel || !teamId || !sessionId)
    return <WorkspaceAgentPane ws={ws} user={user} workspaceExpanded={workspaceExpanded} />

  // Like the agent's pane: a page opened from the sidebar takes its place.
  return (
    <main
      data-workspace-focus-surface="session"
      inert={workspaceExpanded}
      // A channel is a sheet on the desk, like an agent's pane.
      className={clsx(
        'workspace-content-surface min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        ws.dockOpen && 'workspace-content-surface--leading',
        workspaceExpanded && 'workspace-content-surface--collapsed',
        ws.mainPageOpen ? 'hidden' : 'flex',
      )}
    >
      <ChannelPane
        key={sessionId}
        teamId={teamId}
        channelId={sessionId}
        user={user}
        dockOpen={ws.dockOpen}
        grip={<PaneGrip />}
        // With the sidebar collapsed, the header clears the traffic lights and
        // carries the sidebar's toggle, as an agent's pane does.
        titlebarLeading={<CornerSidebarToggle />}
        titlebarClassName={cornerPane ? CORNER_TITLEBAR_CLASS : undefined}
        onOpenTask={onOpenTask}
        onOpenSession={(agentId) => ws.workspaceActions.selectSession(agentId, { teamId })}
        onOpenNuphosLink={ws.stableOpenNuphosLinkFromChat}
      />
    </main>
  )
}
