import { clsx } from 'clsx'
import { createPortal } from 'react-dom'

import { ConfettiBurst } from '../../components/ConfettiBurst'
import { PortForwardBottomBar } from '../../components/PortForwardBottomBar'
import { ShortcutsHelpModal } from '../../components/ShortcutsHelpModal'
import { Sidebar } from '../../components/Sidebar'
import { TeamInvitationsTakeover } from '../../components/TeamInvitationsPanel'
import { CreateOrJoinTeamView } from '../../views/CreateOrJoinTeamView'
import { OnboardingFlow } from '../../views/onboarding/OnboardingFlow'
import { SettingsPage } from '../../views/SettingsPage'
import { UnknownTeamGate } from '../../views/UnknownTeamGate'

import { useWorkspaceController } from './useWorkspaceController'
import { useWorkspaceTabMigrations } from './useWorkspaceTabMigrations'
import { WorkspaceAgentPane } from './WorkspaceAgentPane'
import { WorkspaceBindDialogs } from './WorkspaceBindDialogs'
import { WorkspaceDockPanels } from './WorkspaceDockPanels'
import { WorkspaceMainPane } from './WorkspaceMainPane'
import { useWorkspacePane } from './WorkspacePaneContext'
import { WorkspaceSidebarPanel } from './WorkspaceSidebarPanel'
import { WorkspaceSplits } from './WorkspaceSplits'

import type { WorkspaceProps } from './workspaceProps'

export function Workspace(props: WorkspaceProps) {
  return <WorkspaceSplits {...props} Pane={WorkspacePane} />
}

function WorkspacePane({ user, onLogout, onUserUpdated }: WorkspaceProps) {
  const pane = useWorkspacePane()
  const ws = useWorkspaceController({ user, onLogout, onUserUpdated })

  useWorkspaceTabMigrations(ws)
  const {
    teams,
    pendingInvitations,
    tabs,
    error,
    createOrJoinOpen,
    setCreateOrJoinOpen,
    settingsOpen,
    setSettingsOpen,
    settingsInitialSection,
    shortcutsHelpOpen,
    setShortcutsHelpOpen,
    scope,
    handleTeamUpdated,
    teamsLoading,
    backendUnreachable,
    teamsLoaded,
    onboardingActive,
    onboardingForced,
    onboardingStep,
    onboardingStepNonce,
    onboardingPlatform,
    landingCelebration,
    setLandingCelebration,
    loadTeams,
    joinDiscoverableTeam,
    acceptInvitation,
    rejectInvitation,
    openConversationInNewTab,
    openAuditConversation,
    switchTeam,
    invitationTakeoverOpen,
    takeoverInvitations,
    closeInvitationTakeover,
    continueInvitationTakeover,
    handleTeamRemoved,
    createWorkspaceForOnboarding,
    finishOnboarding,
    closeOnboarding,
    openCreateTeam,
    createTeamAndEnter,
    handleLogout,
  } = ws

  // Full-screen "Create or join team" page (workspace picker). Rendered in the
  // no-scope shell too, where the picker's entry is also reachable.
  const createOrJoinOverlay = createOrJoinOpen ? (
    <CreateOrJoinTeamView
      onClose={() => setCreateOrJoinOpen(false)}
      onJoin={joinDiscoverableTeam}
      onCreate={createTeamAndEnter}
    />
  ) : null

  // Onboarding takes over the whole window. It renders before the no-scope
  // empty shell so a brand-new user sees the guided flow instead of the bare
  // "no teams" error, and before the main shell so a dev-forced session covers
  // the app entirely.
  if (onboardingActive) {
    return (
      <>
        <OnboardingFlow
          key={`onboarding-${String(onboardingStepNonce)}`}
          user={user}
          currentTeamId={scope?.teamId ?? null}
          initialStep={onboardingStep}
          dismissable={onboardingForced}
          onClose={closeOnboarding}
          onCreateWorkspace={createWorkspaceForOnboarding}
          pendingInvitations={pendingInvitations}
          onAcceptInvitation={acceptInvitation}
          onJoinDiscoverableTeam={joinDiscoverableTeam}
          onLogout={handleLogout}
          onFinish={finishOnboarding}
          demoPlatform={onboardingPlatform}
        />
      </>
    )
  }

  if (!scope) {
    return (
      <div className="flex h-full text-main overflow-hidden">
        <Sidebar
          scope={{ kind: 'team', teamId: '' }}
          active=""
          onSelect={() => {}}
          user={user}
          onLogout={handleLogout}
          teamSkeleton={!teamsLoaded && !error}
          onCreateTeam={openCreateTeam}
          pendingInvitations={pendingInvitations}
          onAcceptInvitation={acceptInvitation}
          onRejectInvitation={rejectInvitation}
        />
        <main className="flex-1 flex flex-col min-w-0 bg-main">
          <div className="titlebar-drag h-[44px] flex-shrink-0 border-b border-zGray-800/60" />
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-tertiary text-[13px]">
            {backendUnreachable ? (
              <>
                <div className="w-6 h-6 rounded-full border-2 border-zGray-700 border-t-zViolet-accent animate-spin" />
                <div className="max-w-md text-center">Connecting…</div>
              </>
            ) : error ? (
              <>
                <div className="text-error max-w-md text-center">{error}</div>
                <button
                  onClick={() => void loadTeams()}
                  disabled={teamsLoading}
                  className="px-3 py-1.5 rounded-md bg-zGray-800 hover:bg-zGray-700 text-main text-[12.5px] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {teamsLoading ? 'Retrying…' : 'Retry'}
                </button>
              </>
            ) : pendingInvitations.length > 0 ? (
              <div className="max-w-md text-center">
                Accept a workspace invitation from the sidebar to get started.
              </div>
            ) : (
              'Loading teams…'
            )}
          </div>
        </main>
        {createOrJoinOverlay}
      </div>
    )
  }

  // Shared by the main-shell return below. Not rendered in the onboarding /
  // login / no-scope branches (onboarding hosts its own copy of the
  // invitation flow).
  const invitationTakeover = invitationTakeoverOpen ? (
    <TeamInvitationsTakeover
      invitations={takeoverInvitations}
      onAcceptInvitation={acceptInvitation}
      onRejectInvitation={rejectInvitation}
      onClose={closeInvitationTakeover}
      onContinue={continueInvitationTakeover}
    />
  ) : null

  // Any tab — not just the active one — scoped to a team this account isn't a
  // member of stops the whole app. Per-tab degradation is what let a workspace
  // with a broken tab keep looking usable: switching away hid it, while the
  // broken tab's own pages failed request by request and its chat list
  // answered with whatever the backend could still scope. One team per
  // workspace is the design; a tab that can't name its team breaks it.
  const hasUnknownTeamTab =
    teamsLoaded && tabs.some((tab) => !teams.some((team) => team.id === tab.scope.teamId))

  if (hasUnknownTeamTab) {
    return (
      <>
        <UnknownTeamGate
          teams={teams}
          reloading={teamsLoading}
          onReload={() => void loadTeams()}
          onSwitchTeam={switchTeam}
          onSignOut={handleLogout}
        />
        {invitationTakeover}
      </>
    )
  }

  return (
    <>
      <div
        className={clsx(
          'flex h-full flex-col text-main overflow-hidden',
          // While the settings overlay is open, take the whole app
          // shell out of the layout tree — but keep it mounted, so a composer
          // draft survives opening Settings. Electron's
          // `-webkit-app-region: no-drag` regions (e.g. the tab bar) otherwise
          // punch through the overlay regardless of z-index and break dragging
          // on the overlay's titlebar strip.
          settingsOpen && 'hidden',
        )}
      >
        <div className="relative flex min-h-0 flex-1">
          {pane?.active && pane.sidebarHost
            ? createPortal(<WorkspaceSidebarPanel ws={ws} user={user} />, pane.sidebarHost)
            : null}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex flex-1 min-h-0 min-w-0">
              <WorkspaceAgentPane
                ws={ws}
                user={user}
                workspaceExpanded={ws.workspaceDockExpanded || ws.mainPageOpen}
              />
              {ws.mainPageOpen ? (
                <WorkspaceMainPane ws={ws} user={user} />
              ) : (
                <WorkspaceDockPanels ws={ws} user={user} />
              )}
            </div>
          </div>
        </div>
        <PortForwardBottomBar />
        <WorkspaceBindDialogs ws={ws} />
      </div>
      {settingsOpen && (
        <SettingsPage
          team={ws.currentTeam}
          user={user}
          initialSection={settingsInitialSection ?? undefined}
          onClose={() => setSettingsOpen(false)}
          onTeamUpdated={handleTeamUpdated}
          onTeamRemoved={handleTeamRemoved}
          onSignOut={handleLogout}
          onUserUpdated={onUserUpdated}
          onOpenConversation={(sessionId) => {
            setSettingsOpen(false)
            openConversationInNewTab(sessionId)
          }}
          onOpenAuditConversation={openAuditConversation}
        />
      )}
      <ShortcutsHelpModal open={shortcutsHelpOpen} onClose={() => setShortcutsHelpOpen(false)} />
      {createOrJoinOverlay}
      {invitationTakeover}
      {/* Play a new-workspace celebration once. */}
      {landingCelebration && <ConfettiBurst onDone={() => setLandingCelebration(false)} />}
    </>
  )
}
