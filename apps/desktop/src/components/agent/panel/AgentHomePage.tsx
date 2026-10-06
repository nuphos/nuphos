import clsx from 'clsx'
import { useCallback, useEffect, useState } from 'react'

import { track } from '../../../lib/analytics'
import { ONBOARDING_EXTRA_STEPS_ENABLED } from '../../../views/onboarding/onboardingSteps'

import { Composer } from './Composer'
import { composerDraftKey } from './composerDrafts'
import { ConnectorStrip } from './hero'
import { RevealedHistoryBlock } from './historyRows'
import { AgentHomeAnimation, DelayedPanelReveal } from './homeAnimation'
import { HomeWidgets } from './HomeWidgets'
import { LocalAgentHint } from './LocalAgentHint'
import { StarterSuggestionsBlock } from './starterSuggestions'
import { homeGreeting } from './textUtils'
import { useEntranceCount } from './useEntranceCount'

import type { CredentialSelectorControl } from './credentialSections'
import type { AgentPromptSeed } from './model'
import type { RuntimeControl } from './RuntimeSelector'
import type { AgentConversation, AgentStarterSuggestion, LocalAgentSessionInfo } from '../../../api'
import type { ReactNode } from 'react'

export function AgentHomePage({
  conversations,
  loading,
  onSend,
  onStop,
  streaming,
  credentialSelector,
  runtimeControl,
  newConversationModelControl,
  bypassControl,
  pendingSeed,
  onSeedConsumed,
  autoFocusComposer = false,
  dropRegisterRef,
  unbound = false,
  onStartConnect,
  teamId,
  starterSuggestions = [],
  starterSuggestionsLoading = false,
  shown = true,
  userName,
  onImportSession,
  onOpenConversation,
}: {
  /** Only used to decide whether the starter suggestions are worth showing:
   *  they are for a team that has not started a conversation yet. */
  conversations: AgentConversation[]
  loading: boolean
  onSend: (text: string, filePaths: string[]) => void
  onStop: () => void
  streaming: boolean
  credentialSelector?: CredentialSelectorControl
  runtimeControl?: RuntimeControl
  /** Default-model picker for the runtime this conversation will start on —
   *  there is no session yet to read a live model list from. */
  newConversationModelControl?: ReactNode
  bypassControl?: { active: boolean; onSelect: (bypass: boolean) => void }
  pendingSeed?: AgentPromptSeed | null
  onSeedConsumed?: () => void
  autoFocusComposer?: boolean
  dropRegisterRef?: { current: ((dt: DataTransfer) => void) | null }
  // Both undefined when scope filter doesn't apply (personal feed, no teamId).
  // Both defined together when in a team workspace.
  // Non-null when the team has no bound integrations: the composer is replaced
  // with a step-by-step connect guide and the Recent list is hidden.
  /** No integrations bound yet — starter suggestions stay off, nothing else. */
  unbound?: boolean
  /** Starts the read-only connect flow for the cloud the user picked. */
  onStartConnect?: () => void
  /** Whether the page is in view; each time it comes back, the entrance replays. */
  shown?: boolean
  /** Scopes the connector strip's dismissal. Undefined outside a team. */
  teamId?: string
  // LLM-generated starter questions tailored to the team's connected resources.
  // Empty (and not loading) → the block is hidden.
  starterSuggestions?: AgentStarterSuggestion[]
  starterSuggestionsLoading?: boolean
  /** The signed-in user's display name, greeted by its first word. */
  userName?: string
  /** Continue a local Claude Code / Codex session on the selected agent. */
  onImportSession?: (session: LocalAgentSessionInfo) => void
  /** Opens a team conversation picked from a home card. */
  onOpenConversation?: (sessionId: string, title: string) => void
}) {
  const entranceKey = useEntranceCount(shown)
  const firstRun = unbound && ONBOARDING_EXTRA_STEPS_ENABLED
  const handleStartConnect = useCallback(() => onStartConnect?.(), [onStartConnect])
  // "Not now" has to stick, or the nudge becomes nagging. Per team, so
  // dismissing it for one workspace doesn't hide it in another that genuinely
  // has nothing connected.
  const stripKey = teamId ? `nuphos.agent.connectStrip.dismissed.${teamId}` : null
  const [stripDismissed, setStripDismissed] = useState(() => {
    if (!stripKey || typeof window === 'undefined') return false
    try {
      return localStorage.getItem(stripKey) === '1'
    } catch {
      return false
    }
  })
  const dismissStrip = useCallback(() => {
    setStripDismissed(true)
    track('agent_first_run_strip_dismissed')
    if (!stripKey || typeof window === 'undefined') return
    try {
      localStorage.setItem(stripKey, '1')
    } catch {
      // Storage unavailable — it just won't be remembered next launch.
    }
  }, [stripKey])

  // The funnel starts here: how many teams saw the first-run page at all,
  // against how many went on to bind. Once per mount of the unbound page.
  useEffect(() => {
    if (firstRun) track('agent_first_run_home_viewed')
  }, [firstRun])

  return (
    <div className="flex-1 min-h-0 overflow-hidden selectable">
      <div className="h-full min-h-0 px-6 pb-5 pt-4">
        <div className="mx-auto grid h-full min-h-0 w-full max-w-[820px] grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div />
          <div>
            <AgentHomeAnimation key={entranceKey} title={homeGreeting(userName)} />
            <DelayedPanelReveal replayKey={entranceKey}>
              {/* The composer is untouched — the tray is a sibling painted
                  behind it, same width, with its square top tucked under the
                  composer's bottom so only the part below shows. */}
              <div className="relative">
                {/* First-run backing: an opaque fill at the composer's exact
                    radius, so the translucent composer composites over page
                    colour instead of tinting the tray tucked behind it — and
                    a soft shadow, carried here rather than by the Composer,
                    so the composer visibly presses down on the tray. In the
                    corner notches the rounded backing doesn't reach, the
                    tray's grey shows: that's the emerging-from-behind look,
                    not a leak. Bound teams get no backing at all. */}
                <div
                  className={clsx(
                    'relative z-10',
                    firstRun &&
                      'rounded-xl bg-appBg shadow-[0_1px_2px_rgb(0_0_0_/_0.05),0_6px_18px_-6px_rgb(0_0_0_/_0.08)]',
                  )}
                >
                  <Composer
                    variant="hero"
                    onSend={onSend}
                    onStop={onStop}
                    streaming={streaming}
                    credentialSelector={credentialSelector}
                    runtimeControl={runtimeControl}
                    newConversationModelControl={newConversationModelControl}
                    bypassControl={bypassControl}
                    pendingSeed={pendingSeed}
                    onSeedConsumed={onSeedConsumed}
                    firstRun={firstRun}
                    autoFocus={autoFocusComposer && shown}
                    dropRegisterRef={dropRegisterRef}
                    draftKey={composerDraftKey(teamId)}
                    onImportSession={onImportSession}
                  />
                </div>
                {firstRun && !stripDismissed && (
                  <ConnectorStrip onStart={handleStartConnect} onDismiss={dismissStrip} />
                )}
              </div>
              <LocalAgentHint />
            </DelayedPanelReveal>
          </div>

          <div className="min-h-0 overflow-y-auto overflow-x-hidden pt-3 scrollbar-thin">
            {!unbound &&
              !loading &&
              conversations.length === 0 &&
              (starterSuggestionsLoading || starterSuggestions.length > 0) && (
                <RevealedHistoryBlock key={entranceKey}>
                  <StarterSuggestionsBlock
                    loading={starterSuggestionsLoading}
                    suggestions={starterSuggestions}
                    onPick={(prompt) => onSend(prompt, [])}
                  />
                </RevealedHistoryBlock>
              )}
            {teamId && !unbound && (
              <HomeWidgets key={teamId} teamId={teamId} onOpenConversation={onOpenConversation} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
