import { faDiscord } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react'

import { pullStateColor } from './sessionResourcePresentation'

import type { SessionResource } from '../../api/session-resource-types'
import type { ReactNode } from 'react'

const iconClass = 'size-3 shrink-0'

export const titlebarChip =
  'rounded border border-[var(--sidebar-overlay-active)] px-1.5 py-0.5 transition-colors hover:bg-[var(--sidebar-overlay-hover)] active:bg-[var(--sidebar-overlay-active)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-current'

/** A chip standing for several; the overflow chip and its sizing copy share it so both size alike. */
export function menuChipClass(titlebar: boolean) {
  return `inline-flex shrink-0 items-center gap-1 text-secondary ${titlebar ? titlebarChip : ''}`
}

const ring = <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />

/** A filled disc with the glyph cut out, as Linear draws Done, Canceled and Triage. */
function cutout(glyph: string) {
  return (
    <>
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <path
        d={glyph}
        fill="none"
        stroke="rgb(var(--color-background-base))"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  )
}

/**
 * Linear's own workflow-state glyphs. Each type gets one color, shared by the
 * icon and the tag label, so the tag reads like the issue row in Linear.
 */
const linearStates: Partial<Record<string, { glyph: ReactNode; color: string }>> = {
  triage: { glyph: cutout('M4 5.5h6l-1.5-1.5M10 8.5H4l1.5 1.5'), color: 'session-resource-triage' },
  backlog: {
    glyph: (
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="1.4 1.74"
      />
    ),
    color: 'text-tertiary',
  },
  unstarted: { glyph: ring, color: 'text-tertiary' },
  started: {
    glyph: (
      <>
        {ring}
        <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
      </>
    ),
    color: 'session-resource-started',
  },
  completed: { glyph: cutout('M4.5 7.2l1.7 1.7 3.4-3.6'), color: 'session-resource-linear' },
  canceled: { glyph: cutout('M5 5l4 4M9 5l-4 4'), color: 'text-tertiary' },
  duplicate: { glyph: cutout('M5 5l4 4M9 5l-4 4'), color: 'text-tertiary' },
}

export function resourceStyle(resource: SessionResource): { icon: ReactNode; color: string } {
  if (resource.provider === 'linear') {
    const state = linearStates[resource.stateType ?? '']

    // Links made before state types were stored keep the logo until Linear reports a change.
    if (!state)
      return {
        icon: <img src="/linear.svg" alt="Linear" className={iconClass} />,
        color: 'session-resource-linear',
      }

    return {
      icon: (
        <svg viewBox="0 0 14 14" className={iconClass} aria-hidden>
          {state.glyph}
        </svg>
      ),
      color: state.color,
    }
  }
  if (resource.provider === 'slack')
    return {
      icon: <img src="/slack.svg" alt="Slack" className={iconClass} />,
      color: 'text-secondary',
    }
  if (resource.provider === 'discord')
    return {
      icon: <FontAwesomeIcon icon={faDiscord} className={`${iconClass} text-[#5865f2]`} />,
      color: 'text-secondary',
    }
  const color = pullStateColor(resource)

  if (resource.state === 'merged') return { icon: <GitMerge className={iconClass} />, color }
  if (resource.state === 'closed')
    return { icon: <GitPullRequestClosed className={iconClass} />, color }

  return { icon: <GitPullRequest className={iconClass} />, color }
}
