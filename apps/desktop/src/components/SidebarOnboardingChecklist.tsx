import clsx from 'clsx'
import { useReducedMotion } from 'framer-motion'
import { Check, ChevronRight, ChevronUp, Minus, Rocket } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'

import {
  COLLAPSE_KEY,
  STEPS,
  VISITED_KEY,
  persist,
  readCollapsed,
  readVisited,
} from './sidebar/onboardingChecklistSteps'

import type { TeamInvitation } from '../types'
import type { StepDef } from './sidebar/onboardingChecklistSteps'

// A first-run checklist docked at the bottom of the sidebar, shown only while
// the team has no cloud integration yet (the parent gates on that). Step 1
// (integrate) is the headline: completing it connects a cloud, which makes the
// whole widget disappear, so it never reads as done while the widget is up.
// Step 3 (invite) reflects real team activity: it reads as done once the team
// has more than just the current user, or once there's an outstanding
// invitation the user already sent. Step 2 (chat) has no cheap backend signal,
// so it marks itself complete (persisted per-team) once the user opens it.
//
// Per-team state (collapsed/visited) is seeded once from localStorage on mount,
// so the parent must remount this via a `key={teamId}` when the team changes.

// How long the checklist stays collapsed before its celebratory reveal — long
// enough for the confetti cannons to fire first, so the expand reads as part
// of the same beat rather than competing with it.
const REVEAL_DELAY_MS = 650

// The reveal rides the celebration's rising edge — a mount during one counts,
// and so does a celebration starting while the checklist is already visible
// (the `onboarding.confetti()` dev replay, accepting an invitation from the
// sidebar): collapse — an animated close when currently open — hold a beat,
// then let the existing grid-rows transition play the expansion. Transient
// only; nothing here touches the persisted per-team state. Returns a canceler
// so a manual toggle can outrank a pending reveal.
function useCelebrationReveal(
  celebrateReveal: boolean,
  reduceMotion: boolean,
  setCollapsed: (next: boolean) => void,
) {
  const revealTimerRef = useRef<number | null>(null)
  const prevCelebrateRef = useRef(false)
  const cancelReveal = useCallback(() => {
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current)
      revealTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    const rising = celebrateReveal && !prevCelebrateRef.current

    prevCelebrateRef.current = celebrateReveal
    if (!rising || reduceMotion) return
    cancelReveal()
    setCollapsed(true)
    revealTimerRef.current = window.setTimeout(() => {
      revealTimerRef.current = null
      setCollapsed(false)
    }, REVEAL_DELAY_MS)
  }, [celebrateReveal, reduceMotion, setCollapsed, cancelReveal])

  // Unmount-only timer cleanup, deliberately not the effect above's — the flag
  // falling (confetti finished) must not cancel a reveal that is still holding
  // the checklist collapsed.
  useEffect(() => cancelReveal, [cancelReveal])

  return cancelReveal
}

export function SidebarOnboardingChecklist({
  teamId,
  onNavigate,
  celebrateReveal = false,
}: {
  teamId: string
  onNavigate: (key: string) => void
  /** True while the new-workspace confetti is playing (see Workspace). */
  celebrateReveal?: boolean
}) {
  const reduceMotion = useReducedMotion()
  // Seeded collapsed when mounting mid-celebration (the `key={teamId}` remount
  // on landing in a new team) so the reveal starts closed without a
  // first-frame flash of the expanded card.
  const [collapsed, setCollapsed] = useState(
    () => (celebrateReveal && !reduceMotion) || readCollapsed(teamId),
  )
  const cancelPendingReveal = useCelebrationReveal(
    celebrateReveal,
    Boolean(reduceMotion),
    setCollapsed,
  )
  const [visited, setVisited] = useState<Set<string>>(() => readVisited(teamId))

  // Real team activity drives the "invite" step: it's done once the team has
  // more than the current user, or once there's an outstanding invitation the
  // user already sent (otherwise the sender is stuck on this step until someone
  // accepts). Results are tagged with their teamId so a stale result (or the
  // previous team's, right after a switch) is ignored. Unknown counts as not
  // done, so a fresh solo team never shows the strikethrough.
  const [invite, setInvite] = useState<{
    teamId: string
    memberCount: number
    pendingInvites: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      api.atlasListTeamMembers(teamId),
      // Invitations are best-effort: if that endpoint is unavailable we still
      // fall back to the member count rather than blocking the step.
      api.atlasListTeamInvitations(teamId).catch((): TeamInvitation[] => []),
    ])
      .then(([memberList, invitations]) => {
        if (cancelled) return
        const pendingInvites = invitations.filter(
          (inv) => !inv.acceptedAt && !inv.rejectedAt,
        ).length

        setInvite({ teamId, memberCount: memberList.length, pendingInvites })
      })
      .catch(() => {
        // Leave it unknown on failure so the step stays not-done.
      })

    return () => {
      cancelled = true
    }
  }, [teamId])
  const inviteDone =
    invite?.teamId === teamId && (invite.memberCount > 1 || invite.pendingInvites > 0)

  const isDone = useCallback(
    (step: StepDef) => {
      // The widget only renders while the team has no integration yet, so the
      // integrate step is never done here (completing it unmounts the widget).
      if (step.id === 'integrate') return false
      if (step.id === 'invite') return inviteDone

      return visited.has(step.id)
    },
    [inviteDone, visited],
  )

  const handleOpen = useCallback(
    (step: StepDef) => {
      if (step.completeOnOpen && !visited.has(step.id)) {
        setVisited((prev) => {
          const next = new Set(prev).add(step.id)

          persist(VISITED_KEY(teamId), JSON.stringify([...next]))

          return next
        })
      }
      onNavigate(step.navKey)
    },
    [onNavigate, teamId, visited],
  )

  const setCollapsedPersisted = useCallback(
    (next: boolean) => {
      // A manual toggle outranks a pending celebratory reveal.
      cancelPendingReveal()
      setCollapsed(next)
      persist(COLLAPSE_KEY(teamId), next ? '1' : '0')
    },
    [teamId, cancelPendingReveal],
  )

  const doneCount = useMemo(() => STEPS.filter((s) => isDone(s)).length, [isDone])

  return (
    <div className="px-1 pt-1 pb-2 titlebar-no-drag">
      <div className="rounded-lg rounded-bl-xl border border-zGray-800/70 bg-zGray-900/40 p-2">
        {/* Header — always visible; the whole row toggles minimized/expanded,
            so the minimized state is this same card reduced to its header. */}
        <button
          type="button"
          onClick={() => setCollapsedPersisted(!collapsed)}
          title={collapsed ? 'Expand' : 'Minimize'}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand checklist' : 'Minimize checklist'}
          className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left"
        >
          <Rocket className="h-3.5 w-3.5 flex-shrink-0 text-zViolet-300" strokeWidth={2} />
          <span className="flex-1 truncate text-[12px] font-medium text-secondary">
            Get started
          </span>
          <span className="text-[11px] tabular-nums text-tertiary">
            {doneCount}/{STEPS.length}
          </span>
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-tertiary transition-colors hover:bg-[var(--sidebar-overlay-hover)] hover:text-main">
            {collapsed ? (
              <ChevronUp className="h-3 w-3" strokeWidth={2} />
            ) : (
              <Minus className="h-3 w-3" strokeWidth={2} />
            )}
          </span>
        </button>

        {/* Steps — the 0fr/1fr grid row animates the height between the
            expanded list and the minimized (header-only) card. */}
        <div
          aria-hidden={collapsed}
          className={clsx(
            'grid transition-[grid-template-rows] duration-300 ease-in-out',
            collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
          )}
        >
          <div
            className={clsx(
              'min-h-0 overflow-hidden transition-opacity duration-300',
              collapsed && 'opacity-0',
            )}
          >
            <div className="space-y-0.5 pt-1">
              {STEPS.map((step, i) => {
                const done = isDone(step)

                return (
                  <button
                    key={step.id}
                    type="button"
                    disabled={collapsed}
                    onClick={() => handleOpen(step)}
                    className="group flex w-full items-start gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-overlay-hover)]"
                  >
                    {/* Status marker — check when done, otherwise the step's
                        position, so the list reads as an ordered walkthrough. */}
                    <span
                      className={clsx(
                        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors',
                        done
                          ? 'bg-zViolet-500 text-white'
                          : 'border border-zGray-700 text-tertiary group-hover:border-zGray-600 group-hover:text-secondary',
                      )}
                    >
                      {done ? (
                        <Check className="h-3 w-3" strokeWidth={3} />
                      ) : (
                        <span className="text-[10.5px] font-medium tabular-nums leading-none">
                          {i + 1}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={clsx(
                          'block break-words text-[13px] leading-snug transition-colors',
                          done
                            ? 'text-tertiary line-through'
                            : 'text-secondary group-hover:text-main',
                        )}
                      >
                        {step.label}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-tertiary">
                        {step.description}
                      </span>
                    </span>
                    <ChevronRight
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                      strokeWidth={2}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
