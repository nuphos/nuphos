import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { t } from '../../../i18n'
import { projectName } from '../../../lib/taskProjects'

import { Composer } from './Composer'
import { successfulTurns } from './endEventEffects'
import { StarStrip } from './hero'
import { AgentHomeAnimation, DelayedPanelReveal } from './homeAnimation'
import { HomeGithubButton } from './HomeGithubButton'
import { homeGreeting } from './textUtils'
import { useEntranceCount } from './useEntranceCount'

import type { ComposerSend } from './composerMentionChips'
import type { CredentialSelectorControl } from './credentialSections'
import type { AgentPromptSeed } from './model'
import type { RuntimeControl } from './RuntimeSelector'
import type { LocalAgentSessionInfo } from '../../../api'
import type { ReactNode } from 'react'

// "Not now" has to stick, or a nudge becomes nagging.
function useStickyDismiss(key: string | null) {
  const [dismissed, setDismissed] = useState(() => {
    if (!key) return false
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const dismiss = useCallback(() => {
    setDismissed(true)
    if (!key) return
    try {
      localStorage.setItem(key, '1')
    } catch {
      // Storage unavailable — it just won't be remembered next launch.
    }
  }, [key])

  return [dismissed, dismiss] as const
}

export function AgentHomePage({
  onSend,
  onStop,
  credentialSelector,
  runtimeControl,
  newConversationModelControl,
  bypassControl,
  pendingSeed,
  onSeedConsumed,
  autoFocusComposer = false,
  dropRegisterRef,
  teamId,
  draftKey,
  shown = true,
  newChatRequest = 0,
  userName,
  project,
  onImportSession,
  isTeamAdmin = false,
}: {
  onSend: ComposerSend
  onStop: () => void
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
  /** Whether the page is in view; each time it comes back, the entrance replays. */
  shown?: boolean
  newChatRequest?: number
  /** Scopes the composer's mentions. Undefined outside a team. */
  teamId?: string
  /** Where the composer's unsent text is kept; see newChatDraftKey. */
  draftKey?: string
  /** The signed-in user's display name, greeted by its first word. */
  userName?: string
  /** The project the task starts in, named instead of the greeting. */
  project?: string | null
  /** Continue a local Claude Code / Codex session on the selected agent. */
  onImportSession?: (session: LocalAgentSessionInfo) => void
  /** Administrators can make their home layout the team default. */
  isTeamAdmin?: boolean
  /** Opens a conversation picked from a home card. */
  onOpenNuphosLink?: (href: string) => boolean
  onOpenConversation?: (sessionId: string, title: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (shown && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [shown, newChatRequest])

  const entranceKey = useEntranceCount(shown)
  // Asked once the agent has finished a few turns cleanly. Starring and
  // "not now" both retire it for good.
  const [starDismissed, dismissStar] = useStickyDismiss('nuphos.agent.starStrip.dismissed')
  const showStar = !starDismissed && successfulTurns() >= 5
  const onConnectAgent = runtimeControl?.onConnectAgent

  return (
    // A size container, so the block above can measure half of what is visible.
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin selectable [container-type:size]"
    >
      <div className="flex min-h-full flex-col px-6 pb-8">
        {/* Exactly half the visible height, bottom-aligned: the composer's
            bottom edge sits on the page's middle, and everything else hangs
            below it and scrolls. */}
        <div className="mx-auto flex min-h-[50cqh] w-full max-w-[820px] flex-col justify-end">
          <AgentHomeAnimation
            key={`${entranceKey}:${project ?? ''}`}
            title={
              project
                ? t('New task in {name}', { name: projectName(project) })
                : homeGreeting(userName)
            }
          />
          <DelayedPanelReveal replayKey={entranceKey}>
            {/* The composer is untouched — the tray is a sibling painted
                behind it, same width, with its square top tucked under the
                composer's bottom so only the part below shows. */}
            <div className="relative">
              <div className="relative z-10">
                {/* Strip backing: an opaque fill in the composer's exact
                    shape, so the composer composites over page colour
                    instead of tinting the tray tucked behind it — and a soft
                    shadow, carried here rather than by the Composer, so the
                    composer visibly presses down on the tray. It starts
                    below the hero's `pt-5` banner gap: covering that gap
                    painted a band above the composer. In the corner notches
                    the rounded backing doesn't reach, the tray shows: that's
                    the emerging-from-behind look, not a leak. Only the star
                    strip brings it. */}
                {showStar && (
                  <div
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 top-5 -z-10 rounded-[24px] bg-agentCanvas shadow-[0_1px_2px_rgb(0_0_0_/_0.05),0_6px_18px_-6px_rgb(0_0_0_/_0.08)] [corner-shape:squircle]"
                  />
                )}
                <Composer
                  variant="hero"
                  newChat
                  onSend={onSend}
                  onStop={onStop}
                  credentialSelector={credentialSelector}
                  runtimeControl={runtimeControl}
                  newConversationModelControl={newConversationModelControl}
                  bypassControl={bypassControl}
                  pendingSeed={pendingSeed}
                  onSeedConsumed={onSeedConsumed}
                  autoFocus={autoFocusComposer && shown}
                  dropRegisterRef={dropRegisterRef}
                  draftKey={draftKey}
                  onImportSession={onImportSession}
                  mentionScope={teamId ? { teamId } : undefined}
                />
              </div>
              {showStar && <StarStrip onDone={dismissStar} />}
            </div>
          </DelayedPanelReveal>
        </div>
        <div className="mx-auto w-full max-w-[820px] pb-3">
          <DelayedPanelReveal replayKey={entranceKey}>
            {teamId && isTeamAdmin && !onConnectAgent && !runtimeControl?.loading && (
              <HomeGithubButton teamId={teamId} />
            )}
          </DelayedPanelReveal>
        </div>
      </div>
    </div>
  )
}
