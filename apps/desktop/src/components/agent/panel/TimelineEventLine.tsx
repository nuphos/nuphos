import { Avatar } from '../../Avatar'
import { PlanRevealSection } from '../plan-tool/reveal'

import { ClaudeCodeIcon, CodexIcon } from './icons'
import { LoadingText } from './partChrome'

import type {
  AgentTimelineEvent,
  AgentTimelinePerson,
  AgentTimelineRuntime,
} from '../../../api/agent-types'
import type { ReactNode } from 'react'

function Person({ person }: { person: AgentTimelinePerson }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-secondary">
      <Avatar
        src={person.avatarURL}
        name={person.name}
        size={14}
        className="shrink-0 rounded-full"
      />
      <span className="truncate font-medium">{person.name}</span>
    </span>
  )
}

function Runtime({ runtime }: { runtime: AgentTimelineRuntime }) {
  const Icon = runtime.provider === 'codex' ? CodexIcon : ClaudeCodeIcon

  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-secondary">
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate font-medium">{runtime.label}</span>
    </span>
  )
}

function Rule({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-tertiary" title={title}>
      <div className="h-px flex-1 bg-border/60" />
      <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">{children}</span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  )
}

/** One membership or runtime change, between the messages it happened among.
 *  `reveal` rises it in (texts reveal) — only for a change that happened while
 *  the session was open, so opening a session does not replay its history. */
export function TimelineEventLine({
  event,
  reveal = false,
}: {
  event: AgentTimelineEvent
  reveal?: boolean
}) {
  const line = <EventLine event={event} />

  return reveal ? <PlanRevealSection revealKey={event.at}>{line}</PlanRevealSection> : line
}

function EventLine({ event }: { event: AgentTimelineEvent }) {
  const title = new Date(event.at).toLocaleString()
  const { actor, target, from, to } = event

  // An event from an older backend carries only its sentence.
  if (!actor) return <Rule title={title}>{event.text}</Rule>
  if (event.kind === 'runtime_moved' && to)
    return (
      <Rule title={title}>
        <Person person={actor} /> moved this session{' '}
        {from && (
          <>
            from <Runtime runtime={from} />{' '}
          </>
        )}
        to <Runtime runtime={to} />
      </Rule>
    )
  if (!target) return <Rule title={title}>{event.text}</Rule>
  if (event.kind === 'participant_invited')
    return (
      <Rule title={title}>
        <Person person={actor} /> invited <Person person={target} /> into this session
      </Rule>
    )
  if (target.id === actor.id)
    return (
      <Rule title={title}>
        <Person person={actor} /> left this session
      </Rule>
    )

  return (
    <Rule title={title}>
      <Person person={actor} /> removed <Person person={target} /> from this session
    </Rule>
  )
}

/** The move in flight: rises in, then shimmers (thinking state) until the move's
 *  own event takes its place. */
export function MovingSessionLine({ label }: { label: string }) {
  return (
    <PlanRevealSection revealKey={label}>
      <div role="status">
        <Rule>
          <LoadingText>{`Moving this session to ${label}…`}</LoadingText>
        </Rule>
      </div>
    </PlanRevealSection>
  )
}
