import clsx from 'clsx'
import { useReducedMotion } from 'framer-motion'
import { ArrowLeft, LogOut } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { BindSlackDialog } from '../BindSlackDialog'

import { AgentStage } from './flow/AgentStage'
import { deriveDefaultWorkspaceName } from './flow/shared'
import { useFlowAdvance, useOnboardingTimers } from './flow/use-flow-advance'
import { useJoinOptionsSync, useWorkspaceActions } from './flow/use-join-options'
import { ONBOARDING_EXTRA_STEPS_ENABLED, openingAct } from './onboardingSteps'

import type { Act, ChatStep, OnboardingFlowProps, OnboardingProvider } from './flow/shared'
import type { DiscoverableTeam, TeamInvitation } from '../../types'

export type {
  OnboardingFlowProps,
  OnboardingProvider,
  OnboardingStagePlatform,
} from './flow/shared'

export function OnboardingFlow({
  user,
  currentTeamId,
  demoPlatform = 'mac',
  initialStep,
  dismissable,
  onClose,
  onCreateWorkspace,
  pendingInvitations,
  onAcceptInvitation,
  onJoinDiscoverableTeam,
  onLogout,
  onFinish,
}: OnboardingFlowProps) {
  const initialStepN = initialStep ?? 1
  const [act, setAct] = useState<Act>(openingAct(initialStepN))
  const [chatStep, setChatStep] = useState<ChatStep>(
    initialStepN >= 5
      ? 'slack'
      : initialStepN === 4
        ? 'integration'
        : initialStepN === 3
          ? 'security'
          : 'workspace',
  )
  const [workspaceName, setWorkspaceName] = useState(() => deriveDefaultWorkspaceName(user))
  const [creating, setCreating] = useState(false)
  // The team we operate on once created (or, in the dev-forced case, the team
  // already in scope).
  const [teamId, setTeamId] = useState<string | null>(currentTeamId)
  // The provider named in the connect-step demo (nothing here is
  // ever actually bound; `binding` just plays a scripted sequence for it).
  const [selectedProvider, setSelectedProvider] = useState<OnboardingProvider | null>(null)
  // The Slack closing step: `slackBinding` means the user hit Connect Slack
  // and the OAuth dialog is (about to be) up.
  const [slackBinding, setSlackBinding] = useState(false)
  const [slackDialogOpen, setSlackDialogOpen] = useState(false)
  // Invitations offered in the workspace step. Owned locally as a stable
  // snapshot: late arrivals merge in, and cards never vanish under the user
  // when the parent's pending list refetches.
  const [invitations, setInvitations] = useState<TeamInvitation[]>(pendingInvitations ?? [])
  const [actingInvitationId, setActingInvitationId] = useState<string | null>(null)
  // True when the workspace came from an accepted invitation (or a discoverable
  // join) rather than being created here — the transcript words the hand-off
  // differently.
  const [joinedExisting, setJoinedExisting] = useState(false)
  // Workspaces advertising the user's email domain — offered next to the
  // invitations as another way into an existing team.
  const [discoverableTeams, setDiscoverableTeams] = useState<DiscoverableTeam[]>([])
  const [joiningTeamId, setJoiningTeamId] = useState<string | null>(null)
  // The workspace step is two screens (Slack-style): `pick` lists the teams the
  // user can join (invitations + domain-discoverable) as the primary action;
  // `create` is the name-your-workspace composer. Pick only renders while join
  // options exist, so `create` is the natural state for a brand-new account.
  // Which one shows is derived below rather than stored — otherwise every
  // late-arriving invitation or discoverable team has to push it back to
  // `pick` from an effect. Set once the user explicitly chooses "create
  // instead", which is what keeps those late arrivals from yanking them back.
  const [explicitCreate, setExplicitCreate] = useState(false)
  // The pick screen is select-then-commit: cards only toggle a selection, and
  // Continue joins the whole set at once (accepted invitations + discoverable
  // joins). `joinedTeams` fills in during that commit — successful cards flip
  // to "Joined" one by one — and the first joined team becomes the context for
  // the remaining steps.
  const [selectedInvitationIds, setSelectedInvitationIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [selectedTeamIds, setSelectedTeamIds] = useState<ReadonlySet<string>>(() => new Set())
  const [committing, setCommitting] = useState(false)
  const [joinedTeams, setJoinedTeams] = useState<{ id: string; name: string }[]>([])
  const reduce = useReducedMotion() ?? false

  useJoinOptionsSync({
    onJoinDiscoverableTeam,
    pendingInvitations,
    setDiscoverableTeams,
    setInvitations,
  })

  const handleShowCreateWorkspace = useCallback(() => setExplicitCreate(true), [])

  const handleShowPickTeams = useCallback(() => setExplicitCreate(false), [])

  // Which screen the workspace step is actually showing: the team list only
  // exists while there is something to join, so an empty list falls back to the
  // create form. Shared by the stage prop and the Back control below.
  const hasJoinOptions = invitations.length > 0 || discoverableTeams.length > 0
  const effectiveWorkspaceMode = !explicitCreate && hasJoinOptions ? 'pick' : 'create'

  // Back rewinds one screen, and only while the workspace step is up — past
  // that the workspace exists and there is nothing safe to return to. From the
  // create form that means the team list (when there is one); from the team
  // list (or a create form with nothing to go back to) it replays the intro.
  const handleBack = useCallback(() => {
    if (effectiveWorkspaceMode === 'create' && hasJoinOptions) {
      handleShowPickTeams()

      return
    }
    setAct('intro')
  }, [effectiveWorkspaceMode, hasJoinOptions, handleShowPickTeams])
  const canGoBack =
    act === 'chat' &&
    chatStep === 'workspace' &&
    (ONBOARDING_EXTRA_STEPS_ENABLED || (effectiveWorkspaceMode === 'create' && hasJoinOptions))

  const { bindDialogTimerRef, demoAdvanceTimerRef } = useOnboardingTimers()

  const handleStart = useCallback(() => setAct('chat'), [])

  const { handleCreate, toggleInvitationSelected, toggleTeamSelected, handleContinueSelected } =
    useWorkspaceActions({
      workspaceName,
      setWorkspaceName,
      creating,
      setCreating,
      setChatStep,
      onCreateWorkspace,
      setTeamId,
      onAcceptInvitation,
      onJoinDiscoverableTeam,
      setActingInvitationId,
      invitations,
      discoverableTeams,
      selectedInvitationIds,
      setSelectedInvitationIds,
      selectedTeamIds,
      setSelectedTeamIds,
      committing,
      setCommitting,
      setJoinedTeams,
      setJoiningTeamId,
      joinedTeams,
      setJoinedExisting,
      onFinish,
    })

  const {
    handleSecurityAck,
    handlePickProvider,
    handleIntegrationNext,
    handleBindingDone,
    handleConnectSlack,
    handleSlackDialogClose,
    slackOutcome,
    handleSlackBound,
    handleSkipSlack,
    handleEnterApp,
  } = useFlowAdvance({
    joinedExisting,
    onFinish,
    teamId,
    currentTeamId,
    setTeamId,
    setChatStep,
    setSelectedProvider,
    setSlackBinding,
    setSlackDialogOpen,
    bindDialogTimerRef,
    demoAdvanceTimerRef,
  })

  // The visible titlebar and close button are intentionally gone. Dev-forced
  // sessions keep an invisible Esc escape hatch so debugging stays painless.
  useEffect(() => {
    if (!dismissable) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [dismissable, onClose])

  return (
    // The overlay stays transparent so the window's native vibrancy/blur shows
    // through the (translucent) sidebar-surface, like the real docked sidebar.
    // z-40 keeps it BELOW the Slack dialog's modal (z-50) so that pops on top.
    // `titlebar-drag` makes the whole page a window-drag region; interactive
    // controls opt out with `titlebar-no-drag`. While the Slack dialog is open
    // we drop the drag region entirely — an Electron drag region otherwise
    // eats the mouse events the (portaled) dialog needs.
    <div
      className={clsx(
        'fixed inset-0 z-40 flex flex-col text-main',
        !slackDialogOpen && 'titlebar-drag',
      )}
    >
      <div className="relative flex-1 min-h-0">
        <AgentStage
          phase={act}
          chatStep={chatStep}
          user={user}
          reduce={reduce}
          stagePlatform={demoPlatform}
          workspaceName={workspaceName}
          onWorkspaceNameChange={setWorkspaceName}
          creating={creating}
          onStart={handleStart}
          onCreate={() => void handleCreate()}
          onSecurityAck={handleSecurityAck}
          selectedProvider={selectedProvider}
          onPickProvider={handlePickProvider}
          onIntegrationNext={handleIntegrationNext}
          onBindingDone={handleBindingDone}
          slackBinding={slackBinding}
          slackOutcome={slackOutcome}
          onConnectSlack={handleConnectSlack}
          onSkipSlack={handleSkipSlack}
          onEnterApp={handleEnterApp}
          invitations={invitations}
          actingInvitationId={actingInvitationId}
          discoverableTeams={discoverableTeams}
          joiningTeamId={joiningTeamId}
          selectedInvitationIds={selectedInvitationIds}
          selectedTeamIds={selectedTeamIds}
          committing={committing}
          onToggleInvitation={toggleInvitationSelected}
          onToggleTeam={toggleTeamSelected}
          joinedExisting={joinedExisting}
          workspaceMode={effectiveWorkspaceMode}
          onShowCreateWorkspace={handleShowCreateWorkspace}
          joinedTeams={joinedTeams}
          onContinueJoined={() => void handleContinueSelected()}
        />
        {/* Back — top-left, directly mirroring Log out at the bottom-left. It
            sits BELOW the 42px titlebar row rather than inside it, so it never
            crowds the macOS traffic lights. */}
        {canGoBack && (
          <button
            type="button"
            onClick={handleBack}
            className="titlebar-no-drag absolute top-12 left-3 z-10 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-secondary"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            Back
          </button>
        )}
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="titlebar-no-drag absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-secondary"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
            Log out
          </button>
        )}
      </div>

      {slackDialogOpen && teamId && (
        <BindSlackDialog
          open
          teamId={teamId}
          onClose={handleSlackDialogClose}
          onBound={handleSlackBound}
        />
      )}
    </div>
  )
}
