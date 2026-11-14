import { clsx } from 'clsx'
import { useState } from 'react'

import { useIsChannel } from '../../components/channels/channelKind'
import { ChannelPane } from '../../components/channels/ChannelPane'
import { useAgentSessions } from '../../components/sidebar/agentSessions'
import { useSidebarMode } from '../../components/sidebar/useSidebarMode'

import { CORNER_TITLEBAR_CLASS, CornerSidebarToggle } from './CornerSidebarToggle'
import { PaneGrip } from './PaneGrip'
import { retainSessionViews } from './retainedSessionViews'
import { WorkspaceAgentPane } from './WorkspaceAgentPane'
import { WorkspaceBotsStart } from './WorkspaceBotsStart'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { RetainedSessionViews } from './retainedSessionViews'
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
  const bots = useAgentSessions(teamId ?? '')
  const firstBot =
    bots.data !== undefined && !bots.data.some((row) => row.avatar && row.kind !== 'channel')
  const sessionId = ws.selectedSessionId
  const channel = useIsChannel(teamId, sessionId)
  const cornerPane = useWorkspacePane()?.cornerPane ?? false

  const [retained, setRetained] = useState<RetainedSessionViews>({ teamId })
  const views = retainSessionViews(retained, {
    teamId,
    sessionId,
    channel,
    readOnly: ws.selectedSessionReadOnly,
  })

  if (views !== retained) setRetained(views)
  const [mode] = useSidebarMode(teamId ?? '', sessionId)
  const botsStart = Boolean(teamId && mode === 0 && !sessionId && !ws.mainPageOpen)
  const agentVisible = channel === false && !botsStart
  const channelVisible = channel === true

  return (
    <>
      {teamId && (
        <WorkspaceBotsStart
          key={teamId}
          visible={botsStart}
          firstBot={firstBot}
          teamId={teamId}
          onOpen={(id) => ws.workspaceActions.selectSession(id, { teamId })}
        />
      )}
      {views.agent && (
        <WorkspaceAgentPane
          ws={{
            ...ws,
            selectedSessionId: views.agent.sessionId,
            selectedSessionReadOnly: views.agent.readOnly,
          }}
          user={user}
          workspaceExpanded={workspaceExpanded}
          foreground={agentVisible}
        />
      )}
      {teamId && views.channelId && (
        <main
          data-workspace-focus-surface="session"
          inert={workspaceExpanded || !channelVisible}
          className={clsx(
            'workspace-content-surface min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
            ws.dockOpen && 'workspace-content-surface--leading',
            workspaceExpanded && 'workspace-content-surface--collapsed',
            ws.mainPageOpen || !channelVisible ? 'hidden' : 'flex',
          )}
        >
          <ChannelPane
            key={`${teamId}:${views.channelId}`}
            teamId={teamId}
            channelId={views.channelId}
            visible={channelVisible && !ws.mainPageOpen && !workspaceExpanded}
            user={user}
            dockOpen={ws.dockOpen}
            grip={<PaneGrip />}
            titlebarLeading={<CornerSidebarToggle />}
            titlebarClassName={cornerPane ? CORNER_TITLEBAR_CLASS : undefined}
            onOpenTask={onOpenTask}
            onOpenSession={(agentId) => ws.workspaceActions.selectSession(agentId, { teamId })}
            onOpenNuphosLink={ws.stableOpenNuphosLinkFromChat}
            fixes={{
              isTeamAdmin: ws.currentTeam?.role === 'ADMINISTRATOR',
              onOpenAgentSettings: () => ws.openSettingsSection('workspace.agent'),
            }}
          />
        </main>
      )}
      {channel === undefined && <div className="min-w-0 flex-1" />}
    </>
  )
}
