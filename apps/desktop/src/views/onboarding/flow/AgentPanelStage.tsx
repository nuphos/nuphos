import clsx from 'clsx'
import { useEffect, useRef } from 'react'

import { ChatTranscript } from './ChatTranscript'
import { PanelComposer } from './PanelComposer'

import type { ChatStep } from './shared'
import type { DiscoverableTeam, TeamInvitation, UserInfo } from '../../../types'

// The frosted Agent panel onboarding runs in: the conversation on top and the
// composer for the workspace name (or the list of teams to join) below it.
export function AgentPanelStage({
  chatStep,
  user,
  reduce,
  workspaceName,
  onWorkspaceNameChange,
  creating,
  onCreate,
  invitations,
  actingInvitationId,
  discoverableTeams,
  joiningTeamId,
  selectedInvitationIds,
  selectedTeamIds,
  committing,
  onToggleInvitation,
  onToggleTeam,
  workspaceMode,
  onShowCreateWorkspace,
  joinedTeams,
  onContinueJoined,
}: {
  chatStep: ChatStep
  user: UserInfo
  reduce: boolean
  workspaceName: string
  onWorkspaceNameChange: (v: string) => void
  creating: boolean
  onCreate: () => void
  invitations: TeamInvitation[]
  actingInvitationId: string | null
  discoverableTeams: DiscoverableTeam[]
  joiningTeamId: string | null
  selectedInvitationIds: ReadonlySet<string>
  selectedTeamIds: ReadonlySet<string>
  committing: boolean
  onToggleInvitation: (invitation: TeamInvitation) => void
  onToggleTeam: (team: DiscoverableTeam) => void
  workspaceMode: 'pick' | 'create'
  onShowCreateWorkspace: () => void
  joinedTeams: { id: string; name: string }[]
  onContinueJoined: () => void
}) {
  // The composer is the workspace name input, shown only while we're asking for
  // the name; once sent it fades out.
  const composerActive = chatStep === 'workspace'
  const canCreate = workspaceName.trim().length > 0 && !creating
  const hasJoinOptions = invitations.length > 0 || discoverableTeams.length > 0
  const joinedTeamIds = new Set(joinedTeams.map((team) => team.id))

  // Focus the input whenever the create screen shows (the pick screen has no
  // text input, and leaving it for create should land the caret in the box).
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (composerActive && workspaceMode === 'create') inputRef.current?.focus()
  }, [composerActive, workspaceMode])

  return (
    <aside className="relative flex h-full w-full flex-col overflow-hidden sidebar-surface">
      {/* Header spacer — keeps the content clear of the macOS traffic lights.
          It used to carry decorative sidebar icons (new chat / expand /
          collapse); they did nothing here, so only the clearance remains. */}
      <div className="h-[42px] flex-shrink-0" aria-hidden />

      {/* AGENT CONTAINER — full panel width so the transcript's scrollbar sits
          at the window's right edge; the message/composer COLUMN inside stays
          capped at 600 and centered (mx-auto). */}
      <div
        className={clsx(
          'relative flex min-h-0 w-full flex-1 flex-col',
          // While asking for the workspace name, center the greeting + input as
          // one group so the box sits right under the question instead of being
          // pinned to the bottom of the full-height panel.
          composerActive && 'justify-center',
        )}
      >
        {/* Transcript. The scroll container spans the panel (scrollbar at the window edge)
            and opts out of the window-drag region: an Electron drag region
            swallows wheel events, which made the transcript unscrollable. */}
        <div
          className={clsx(
            'titlebar-no-drag overflow-y-auto scrollbar-thin',
            composerActive ? 'flex-shrink-0' : 'min-h-0 flex-1',
          )}
        >
          {/* Once the conversation scrolls (composer gone), keep a third of
              the panel blank below the newest content — the transcript reads
              like an active chat, not text pinned to the bottom edge. */}
          <div style={{ maxWidth: 600 }} className="mx-auto w-full px-4 pb-8 pt-4">
            <ChatTranscript
              user={user}
              reduce={reduce}
              chatStep={chatStep}
              workspaceName={workspaceName}
              hasJoinOptions={hasJoinOptions}
              workspaceMode={workspaceMode}
            />
          </div>
        </div>

        <PanelComposer
          composerActive={composerActive}
          workspaceMode={workspaceMode}
          inputRef={inputRef}
          workspaceName={workspaceName}
          onWorkspaceNameChange={onWorkspaceNameChange}
          onCreate={onCreate}
          canCreate={canCreate}
          creating={creating}
          invitations={invitations}
          discoverableTeams={discoverableTeams}
          joinedTeamIds={joinedTeamIds}
          actingInvitationId={actingInvitationId}
          joiningTeamId={joiningTeamId}
          selectedInvitationIds={selectedInvitationIds}
          selectedTeamIds={selectedTeamIds}
          committing={committing}
          onToggleInvitation={onToggleInvitation}
          onToggleTeam={onToggleTeam}
          joinedTeams={joinedTeams}
          onContinueJoined={onContinueJoined}
          onShowCreateWorkspace={onShowCreateWorkspace}
        />
      </div>
    </aside>
  )
}
