import clsx from 'clsx'
import { ArrowRight, ArrowUp, Loader2 } from 'lucide-react'

import { InvitationList } from '../../../components/InvitationList'
import { Button } from '../../../components/ui/button'
import { InputGroup, InputGroupInput } from '../../../components/ui/input-group'

import type { DiscoverableTeam, TeamInvitation } from '../../../types'
import type { RefObject } from 'react'

export function PanelComposer({
  composerActive,
  workspaceMode,
  inputRef,
  workspaceName,
  onWorkspaceNameChange,
  onCreate,
  canCreate,
  creating,
  invitations,
  discoverableTeams,
  joinedTeamIds,
  actingInvitationId,
  joiningTeamId,
  selectedInvitationIds,
  selectedTeamIds,
  committing,
  onToggleInvitation,
  onToggleTeam,
  joinedTeams,
  onContinueJoined,
  onShowCreateWorkspace,
}: {
  composerActive: boolean
  workspaceMode: 'pick' | 'create'
  inputRef: RefObject<HTMLInputElement | null>
  workspaceName: string
  onWorkspaceNameChange: (v: string) => void
  onCreate: () => void
  canCreate: boolean
  creating: boolean
  invitations: TeamInvitation[]
  discoverableTeams: DiscoverableTeam[]
  joinedTeamIds: Set<string>
  actingInvitationId: string | null
  joiningTeamId: string | null
  selectedInvitationIds: ReadonlySet<string>
  selectedTeamIds: ReadonlySet<string>
  committing: boolean
  onToggleInvitation: (invitation: TeamInvitation) => void
  onToggleTeam: (team: DiscoverableTeam) => void
  joinedTeams: { id: string; name: string }[]
  onContinueJoined: () => void
  onShowCreateWorkspace: () => void
}) {
  const selectedCount = selectedInvitationIds.size + selectedTeamIds.size

  // Composer — the workspace name input. Shown only while we're asking for
  // the name (the intro demo panel has no input box); it fades + collapses
  // once the name is sent.
  return (
    <div
      style={{ maxWidth: 600 }}
      className={clsx(
        'mx-auto w-full flex-shrink-0 overflow-hidden p-1 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
        composerActive ? 'max-h-[70vh] opacity-100' : 'pointer-events-none max-h-0 opacity-0',
      )}
    >
      {workspaceMode === 'create' ? (
        <>
          <InputGroup className="relative w-full rounded-2xl border border-zGray-800/80 bg-zGray-900/60 px-4 pt-4 pb-3 backdrop-blur transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]">
            <div className="relative min-h-[36px]">
              <InputGroupInput
                ref={inputRef}
                type="text"
                required
                maxLength={80}
                value={workspaceName}
                onChange={(e) => onWorkspaceNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onCreate()
                  }
                }}
                placeholder="Name your workspace…"
                className="titlebar-no-drag w-full text-[18px] leading-relaxed text-main placeholder:text-tertiary"
              />
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1" />
              <button
                type="button"
                onClick={onCreate}
                disabled={!canCreate}
                title="Create workspace"
                className={clsx(
                  'titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                  canCreate ? 'bg-zViolet-500 text-white hover:bg-zViolet-400' : 'text-tertiary',
                )}
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                ) : (
                  <ArrowUp className="h-4 w-4" strokeWidth={2.4} />
                )}
              </button>
            </div>
          </InputGroup>
        </>
      ) : (
        <div>
          <div className="max-h-[52vh] space-y-2 overflow-y-auto scrollbar-thin">
            <InvitationList
              invitations={invitations}
              discoverableTeams={discoverableTeams}
              joinedTeamIds={joinedTeamIds}
              actingInvitationId={actingInvitationId}
              joiningTeamId={joiningTeamId}
              selection={{
                invitationIds: selectedInvitationIds,
                teamIds: selectedTeamIds,
                committing,
                onToggleInvitation,
                onToggleTeam,
              }}
            />
          </div>
          <div className="mt-4 flex justify-center">
            <Button
              onClick={onContinueJoined}
              disabled={committing || (selectedCount === 0 && joinedTeams.length === 0)}
              className="group titlebar-no-drag"
            >
              <span>Continue</span>
              {committing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              )}
            </Button>
          </div>
          <div className="mt-4 flex items-center gap-3" aria-hidden>
            <div className="h-px flex-1 bg-zGray-800/80" />
            <span className="text-[11.5px] text-tertiary">or</span>
            <div className="h-px flex-1 bg-zGray-800/80" />
          </div>
          <div className="mt-3 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={onShowCreateWorkspace}
              className="titlebar-no-drag"
            >
              Create a new workspace instead
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
