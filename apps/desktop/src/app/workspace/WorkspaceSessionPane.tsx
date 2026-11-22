import { clsx } from 'clsx'
import { Activity, useState } from 'react'

import { useIsChannel } from '../../components/channels/channelKind'
import { ChannelPane } from '../../components/channels/ChannelPane'
import { usePrefetchRecentChannels } from '../../components/channels/useChannel'
import { useAgentSessions } from '../../components/sidebar/agentSessions'
import { useSidebarMode } from '../../components/sidebar/useSidebarMode'

import { CORNER_TITLEBAR_CLASS, CornerSidebarToggle } from './CornerSidebarToggle'
import { SplitPaneCloseButton } from './PaneCloseButton'
import { PaneGrip } from './PaneGrip'
import { retainSessionViews } from './retainedSessionViews'
import { WorkspaceAgentPane } from './WorkspaceAgentPane'
import { WorkspaceBotsStart } from './WorkspaceBotsStart'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { RetainedSessionViews } from './retainedSessionViews'
import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

type SessionPaneProps = {
  ws: WorkspaceController
  user: UserInfo
  workspaceExpanded?: boolean
  onOpenTask?: (sessionId: string) => void
}

/** The open session: a channel's own view, or the agent's session as before. */
export function WorkspaceSessionPane(props: SessionPaneProps) {
  const teamId = props.ws.scope?.teamId

  return teamId ? <TeamSessionPane {...props} teamId={teamId} /> : null
}

function TeamSessionPane({
  ws,
  teamId,
  user,
  workspaceExpanded = false,
  onOpenTask,
}: SessionPaneProps & { teamId: string }) {
  const bots = useAgentSessions(teamId)
  const firstBot =
    bots.data !== undefined && !bots.data.some((row) => row.avatar && row.kind !== 'channel')

  usePrefetchRecentChannels(teamId, bots.data)
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
  const [mode] = useSidebarMode(teamId, sessionId)
  const botsStart = mode === 0 && !sessionId && !ws.mainPageOpen
  const agentVisible = channel === false && !botsStart
  const channelVisible = channel === true
  const openChannel = views.channelIds?.at(-1)

  return (
    <>
      <WorkspaceBotsStart
        key={teamId}
        visible={botsStart}
        loaded={bots.data !== undefined}
        firstBot={firstBot}
        teamId={teamId}
        onOpen={(id) => ws.workspaceActions.selectSession(id, { teamId })}
      />
      {views.agent && (
        <WorkspaceAgentPane
          ws={{
            ...ws,
            selectedSessionId: views.agent.sessionId,
            selectedSessionReadOnly: views.agent.readOnly,
          }}
          teamId={teamId}
          user={user}
          workspaceExpanded={workspaceExpanded}
          foreground={agentVisible}
        />
      )}
      {views.channelIds && (
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
          {/* Recent Bot chats stay mounted, hidden while another is open, so switching
              back shows the chat again instead of building it anew. */}
          {views.channelIds.map((channelId) => (
            <Activity
              key={`${teamId}:${channelId}`}
              mode={channelId === openChannel ? 'visible' : 'hidden'}
            >
              <ChannelPane
                teamId={teamId}
                channelId={channelId}
                visible={
                  channelId === openChannel &&
                  channelVisible &&
                  !ws.mainPageOpen &&
                  !workspaceExpanded
                }
                user={user}
                dockOpen={ws.dockOpen}
                grip={
                  // A Bot's chat in a split closes like a task's: the pane's close, then its grip.
                  <>
                    <SplitPaneCloseButton />
                    <PaneGrip />
                  </>
                }
                titlebarLeading={<CornerSidebarToggle />}
                titlebarClassName={cornerPane ? CORNER_TITLEBAR_CLASS : undefined}
                onOpenTask={onOpenTask}
                onOpenSession={(agentId) => ws.workspaceActions.selectSession(agentId, { teamId })}
                onOpenNuphosLink={ws.stableOpenNuphosLinkFromChat}
                fixes={{
                  isTeamAdmin: ws.currentTeam?.role === 'ADMINISTRATOR',
                  onOpenAgentSettings: () => ws.openSettingsSection('workspace.computers'),
                }}
              />
            </Activity>
          ))}
        </main>
      )}
      {channel === undefined && <div className="min-w-0 flex-1" />}
    </>
  )
}
