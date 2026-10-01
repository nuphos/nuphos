import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ChatTranscript } from './ChatTranscript'
import { DemoTranscript } from './DemoTranscript'
import { PanelComposer } from './PanelComposer'
import { DEMO_SCENARIOS, EASE_OUT } from './shared'

import type {
  Act,
  ChatStep,
  OnboardingProvider,
  OnboardingStagePlatform,
  SlackOutcome,
} from './shared'
import type { DiscoverableTeam, TeamInvitation, UserInfo } from '../../../types'

// The frosted Agent panel that fills the AgentStage's right column. In `intro`
// it plays the scripted demo conversation (no input box); in `chat` it runs the
// real onboarding conversation (create workspace → demo connecting a cloud), showing the
// composer for the workspace name. The shared chrome keeps the morph reading as
// one continuous panel.
export function AgentPanelStage({
  phase,
  chatStep,
  user,
  reduce,
  stagePlatform,
  scenarioIndex,
  onAdvance,
  workspaceName,
  onWorkspaceNameChange,
  creating,
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
  scenarioIndex: number
  onAdvance: () => void
  workspaceName: string
  onWorkspaceNameChange: (v: string) => void
  creating: boolean
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
  // The composer is the workspace name input, shown only while we're asking for
  // the name; once sent it fades out (integration uses chips, not free text).
  // It's hidden entirely in the intro phase — the demo panel shows no input box.
  const composerActive = isChat && chatStep === 'workspace'
  const canCreate = workspaceName.trim().length > 0 && !creating
  const hasJoinOptions = invitations.length > 0 || discoverableTeams.length > 0
  const joinedTeamIds = new Set(joinedTeams.map((team) => team.id))

  // The input mounts (hidden) during the intro, so a one-shot `autoFocus` fires
  // too early and never re-fires. Focus it when the composer actually appears
  // (and only on the create screen — the pick screen has no text input).
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (composerActive && workspaceMode === 'create') inputRef.current?.focus()
  }, [composerActive, workspaceMode])

  // The transcript stays where the user put it — content is read from the top
  // down, so nothing here scrolls on their behalf. When a step is taller than
  // the panel we say so instead, with a hint that scrolls one screen per click
  // and disappears once they reach the end.
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [moreBelow, setMoreBelow] = useState(false)

  useEffect(() => {
    const scroller = scrollRef.current
    const content = contentRef.current

    if (!scroller || !content) return
    // Only claim there's more when it's a screenful away — a few stray pixels
    // of overflow would leave the hint stuck on with nothing to reveal.
    const measure = () =>
      setMoreBelow(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 24)

    measure()
    scroller.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)

    ro.observe(content)
    ro.observe(scroller)

    return () => {
      scroller.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [])
  const scrollDown = useCallback(() => {
    const scroller = scrollRef.current

    if (!scroller) return
    scroller.scrollBy({
      top: scroller.clientHeight * 0.8,
      behavior: reduce ? 'auto' : 'smooth',
    })
  }, [reduce])

  return (
    <aside className="relative flex h-full w-full flex-col overflow-hidden sidebar-surface">
      {/* Header spacer — keeps the content clear of the macOS traffic lights.
          It used to carry decorative sidebar icons (new chat / expand /
          collapse); they did nothing here, so only the clearance remains. */}
      <div className="h-[42px] flex-shrink-0" aria-hidden />

      {/* AGENT CONTAINER — full panel width so the transcript's scrollbar sits
          at the window's right edge; the message/composer COLUMN inside stays
          capped at 600 and centered (mx-auto). As the surrounding sidebar
          widens (420 → full), that column grows to its cap and then centers —
          it never goes full-width, so the input tracks it smoothly (no
          full-width-then-shrink) and the messages sit in the centred column
          instead of hugging the left edge. */}
      <div
        className={clsx(
          'relative flex min-h-0 w-full flex-1 flex-col',
          // While asking for the workspace name, center the greeting + input as
          // one group so the box sits right under the question instead of being
          // pinned to the bottom of the full-height panel.
          composerActive && 'justify-center',
        )}
      >
        {/* Transcript — swaps the scripted demo for the real onboarding chat.
            The scroll container spans the panel (scrollbar at the window edge)
            and opts out of the window-drag region: an Electron drag region
            swallows wheel events, which made the transcript unscrollable. */}
        <div
          ref={scrollRef}
          data-transcript-scroll
          className={clsx(
            'titlebar-no-drag overflow-y-auto scrollbar-thin',
            composerActive ? 'flex-shrink-0' : 'min-h-0 flex-1',
          )}
        >
          {/* Once the conversation scrolls (composer gone), keep a third of
              the panel blank below the newest content — the transcript reads
              like an active chat, not text pinned to the bottom edge. */}
          <div style={{ maxWidth: 600 }} ref={contentRef} className="mx-auto w-full px-4 pb-8 pt-4">
            {/* No `initial={false}` here. It reads as "don't animate the very
                first transcript in", but framer-motion memoizes the presence
                context without `initial` in the deps — so the value captured on
                this AnimatePresence's first render is handed to every motion
                component below it for the rest of the session, and anything not
                wrapped in its own AnimatePresence (the claims' supporting
                points, the reply answers, every button that reveals) silently
                lost its entrance. The cost of dropping it is the intro panel
                fading in on first paint instead of appearing outright. */}
            <AnimatePresence mode="wait">
              {isChat ? (
                <ChatTranscript
                  key="chat"
                  user={user}
                  reduce={reduce}
                  stagePlatform={stagePlatform}
                  chatStep={chatStep}
                  workspaceName={workspaceName}
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
                  hasJoinOptions={hasJoinOptions}
                  workspaceMode={workspaceMode}
                  joinedExisting={joinedExisting}
                />
              ) : (
                <DemoTranscript
                  key={scenarioIndex}
                  scenario={DEMO_SCENARIOS[scenarioIndex]}
                  reduce={reduce}
                  onDone={onAdvance}
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* "There's more below" — the transcript never scrolls itself, so this
            is how a step taller than the panel announces its remainder. It sits
            over the scroller's bottom edge and clears once the end is in view. */}
        <AnimatePresence>
          {moreBelow && !composerActive && (
            <motion.button
              type="button"
              onClick={scrollDown}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              aria-label="Scroll down for more"
              className="titlebar-no-drag absolute bottom-4 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-zGray-800 bg-zGray-900/80 text-secondary shadow-lg backdrop-blur transition-colors hover:border-zGray-700 hover:text-main outline-none focus-visible:ring-2 focus-visible:ring-zViolet-400/50"
            >
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
            </motion.button>
          )}
        </AnimatePresence>

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
