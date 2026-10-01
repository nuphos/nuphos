import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button } from '../../../components/ui/button'

import { AgentPanelStage } from './AgentPanelStage'
import { PopInWord } from './DemoTranscript'
import { DEMO_SCENARIOS, EASE_OUT } from './shared'

import type {
  Act,
  ChatStep,
  OnboardingProvider,
  OnboardingStagePlatform,
  SlackOutcome,
} from './shared'
import type { DiscoverableTeam, TeamInvitation, UserInfo } from '../../../types'

/* ----------------------------------------------------- Intro + Workspace --- */

// Steps 1 and 2 are one continuously-morphing stage. In the `intro` phase it's a
// split: introduction copy on the left and a docked 420px Agent demo panel on
// the right. Advancing to `workspace` widens that panel to fill the whole screen
// (CSS width transition — a layout property, so NO compositing layer is created
// and the window vibrancy keeps showing through the frost) while the left copy
// collapses, and the panel's content morphs from the demo into the workspace
// prompt.
export function AgentStage({
  phase,
  chatStep,
  user,
  reduce,
  stagePlatform,
  workspaceName,
  onWorkspaceNameChange,
  creating,
  onStart,
  onCreate,
  onSecurityAck,
  selectedProvider,
  onPickProvider,
  onIntegrationNext,
  onBindingDone,
  slackBinding,
  slackOutcome,
  onConnectSlack,
  onSkipSlack,
  onEnterApp,
  invitations,
  actingInvitationId,
  discoverableTeams,
  joiningTeamId,
  selectedInvitationIds,
  selectedTeamIds,
  committing,
  onToggleInvitation,
  onToggleTeam,
  joinedExisting,
  workspaceMode,
  onShowCreateWorkspace,
  joinedTeams,
  onContinueJoined,
}: {
  phase: Act
  chatStep: ChatStep
  user: UserInfo
  reduce: boolean
  stagePlatform: OnboardingStagePlatform
  workspaceName: string
  onWorkspaceNameChange: (v: string) => void
  creating: boolean
  onStart: () => void
  onCreate: () => void
  onSecurityAck: () => void
  selectedProvider: OnboardingProvider | null
  onPickProvider: (provider: OnboardingProvider) => void
  onIntegrationNext: () => void
  onBindingDone: () => void
  slackBinding: boolean
  slackOutcome: SlackOutcome
  onConnectSlack: () => void
  onSkipSlack: () => void
  onEnterApp: () => void
  invitations: TeamInvitation[]
  actingInvitationId: string | null
  discoverableTeams: DiscoverableTeam[]
  joiningTeamId: string | null
  selectedInvitationIds: ReadonlySet<string>
  selectedTeamIds: ReadonlySet<string>
  committing: boolean
  onToggleInvitation: (invitation: TeamInvitation) => void
  onToggleTeam: (team: DiscoverableTeam) => void
  joinedExisting: boolean
  workspaceMode: 'pick' | 'create'
  onShowCreateWorkspace: () => void
  joinedTeams: { id: string; name: string }[]
  onContinueJoined: () => void
}) {
  const isChat = phase === 'chat'
  // The demo scenario index is owned here so the headline noun/icon and the
  // panel conversation stay in lock-step (联动).
  const [scenarioIndex, setScenarioIndex] = useState(0)
  const advanceScenario = useCallback(
    () => setScenarioIndex((i) => (i + 1) % DEMO_SCENARIOS.length),
    [],
  )
  const topic = DEMO_SCENARIOS[scenarioIndex].topic

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Left: introduction (opaque). Collapses + fades as we enter the chat. */}
      <div
        className={clsx(
          'content-canvas relative flex flex-1 items-center justify-center overflow-hidden transition-opacity duration-500',
          isChat ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
      >
        {/* Fixed width + no shrink: while the right panel widens over the
            intro, this block must NOT reflow (text rewrapping reads as the
            page deforming). It keeps its shape and is simply clipped by the
            column's overflow-hidden as it slides away. */}
        <div className="flex w-[460px] flex-shrink-0 flex-col items-start px-8 text-left">
          {/* Topic glyph — a bare FA solid icon expressing the current scenario,
              each in its own color, with a matching soft glow centered behind it.
              Same Number pop-in as the headline word. */}
          <div className="relative mb-6 flex h-12 w-12 items-center justify-center">
            <span
              aria-hidden
              className={clsx(
                'pointer-events-none absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl transition-colors duration-500',
                DEMO_SCENARIOS[scenarioIndex].glow,
              )}
            />
            <span key={scenarioIndex} className="relative t-digit-group is-animating">
              <span className="t-digit">
                <FontAwesomeIcon
                  icon={DEMO_SCENARIOS[scenarioIndex].icon}
                  className={clsx('text-[32px]', DEMO_SCENARIOS[scenarioIndex].iconColor)}
                />
              </span>
            </span>
          </div>

          <h1 className="mb-3 text-[34px] font-semibold leading-tight text-main">
            Ask your <PopInWord text={`${topic}.`} />
          </h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.4 }}
            className="mb-8 max-w-[440px] text-[14.5px] leading-relaxed text-secondary"
          >
            Nuphos is an AI agent for your cloud. Describe what you want in plain language and it
            deploys, debugs, and manages your infrastructure for you — watch it work on the right.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.4, ease: EASE_OUT }}
          >
            <Button size="lg" onClick={onStart} className="group titlebar-no-drag">
              <span>Get started</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Button>
          </motion.div>
        </div>
      </div>

      {/* Right: the Agent panel. Width morphs 420px → 100% on entering the chat.
          Width is a layout property (CSS transition), so no compositing layer is
          created and the window vibrancy keeps showing through the frost. */}
      <div
        className="h-full flex-shrink-0 transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ width: isChat ? '100%' : '420px' }}
      >
        <AgentPanelStage
          phase={phase}
          chatStep={chatStep}
          user={user}
          reduce={reduce}
          stagePlatform={stagePlatform}
          scenarioIndex={scenarioIndex}
          onAdvance={advanceScenario}
          workspaceName={workspaceName}
          onWorkspaceNameChange={onWorkspaceNameChange}
          creating={creating}
          onCreate={onCreate}
          onSecurityAck={onSecurityAck}
          selectedProvider={selectedProvider}
          onPickProvider={onPickProvider}
          onIntegrationNext={onIntegrationNext}
          onBindingDone={onBindingDone}
          slackBinding={slackBinding}
          slackOutcome={slackOutcome}
          onConnectSlack={onConnectSlack}
          onSkipSlack={onSkipSlack}
          onEnterApp={onEnterApp}
          invitations={invitations}
          actingInvitationId={actingInvitationId}
          discoverableTeams={discoverableTeams}
          joiningTeamId={joiningTeamId}
          selectedInvitationIds={selectedInvitationIds}
          selectedTeamIds={selectedTeamIds}
          committing={committing}
          onToggleInvitation={onToggleInvitation}
          onToggleTeam={onToggleTeam}
          joinedExisting={joinedExisting}
          workspaceMode={workspaceMode}
          onShowCreateWorkspace={onShowCreateWorkspace}
          joinedTeams={joinedTeams}
          onContinueJoined={onContinueJoined}
        />
      </div>
    </div>
  )
}
