import { Fragment } from 'react'

import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { t } from '../../../i18n'
import { toAbsoluteAtlasUrl } from '../../../lib/webBaseUrl'
import { Avatar } from '../../Avatar'
import { PlanRevealSection } from '../plan-tool/reveal'

import { AgentProviderIcon } from './icons'
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
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-secondary">
      <AgentProviderIcon provider={runtime.provider} className="h-3 w-3 shrink-0" />
      <span className="truncate font-medium">{runtime.label}</span>
    </span>
  )
}

export function Rule({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div
      className="flex min-w-0 items-center gap-1 text-[11.5px] whitespace-nowrap text-tertiary"
      title={title}
    >
      {children}
    </div>
  )
}

/** One membership or runtime change, between the messages it happened among.
 *  `reveal` rises it in (texts reveal) — only for a change that happened while
 *  the session was open, so opening a session does not replay its history. */
export function TimelineEventLine({
  event,
  reveal = false,
  teamId,
  onOpenNuphosLink,
}: {
  event: AgentTimelineEvent
  reveal?: boolean
  teamId?: string
  onOpenNuphosLink?: (href: string) => boolean
}) {
  const line = <EventLine event={event} teamId={teamId} onOpenNuphosLink={onOpenNuphosLink} />

  return reveal ? <PlanRevealSection revealKey={event.at}>{line}</PlanRevealSection> : line
}

function EventLine({
  event,
  teamId,
  onOpenNuphosLink,
}: {
  event: AgentTimelineEvent
  teamId?: string
  onOpenNuphosLink?: (href: string) => boolean
}) {
  const title = new Date(event.at).toLocaleString()
  const { actor, target, from, to } = event

  // An event from an older backend carries only its sentence.
  if (!actor) return <Rule title={title}>{event.text}</Rule>
  if (event.kind === 'message_edited' || event.kind === 'conversation_forked')
    return (
      <ForkedLine
        event={{ ...event, actor }}
        title={title}
        teamId={teamId}
        onOpenNuphosLink={onOpenNuphosLink}
      />
    )
  if (event.kind === 'runtime_fallback_stopped')
    return (
      <Rule title={event.text}>
        {t('No agent in your fallback list could take over')}
        {event.skipped?.length ? (
          <span className="truncate">
            ({event.skipped.map((entry) => `${entry.label}: ${entry.reason}`).join(', ')})
          </span>
        ) : null}
      </Rule>
    )
  if (event.kind === 'runtime_moved' && to) {
    const people = { actor: <Person person={actor} />, to: <Runtime runtime={to} /> }

    if (event.reason && from)
      return (
        <Rule title={title}>
          {fill(FALLBACK_LINE[event.reason], { ...people, from: <Runtime runtime={from} /> })}
        </Rule>
      )

    return (
      <Rule title={title}>
        {from
          ? fill(t('{actor} moved this agent from {from} to {to}'), {
              ...people,
              from: <Runtime runtime={from} />,
            })
          : fill(t('{actor} moved this agent to {to}'), people)}
      </Rule>
    )
  }
  if (!target) return <Rule title={title}>{event.text}</Rule>
  const people = { actor: <Person person={actor} />, target: <Person person={target} /> }

  if (event.kind === 'participant_invited')
    return <Rule title={title}>{fill(t('{actor} invited {target} into this agent'), people)}</Rule>
  if (target.id === actor.id)
    return <Rule title={title}>{fill(t('{actor} left this agent'), people)}</Rule>

  return <Rule title={title}>{fill(t('{actor} removed {target} from this agent'), people)}</Rule>
}

const FALLBACK_LINE = {
  quota: t('{from} was low on usage, so this agent moved to {to}'),
  offline: t('{from} was unreachable, so this agent moved to {to}'),
  failure: t('{from} failed a turn, so this agent moved to {to}'),
}

/** Puts the people and runtimes into a translated sentence where its
 *  `{placeholders}` are, so each language keeps its own word order. */
function fill(text: string, nodes: Record<string, ReactNode>) {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const node = nodes[part.slice(1, -1)]

    return <Fragment key={i}>{part.startsWith('{') && node ? node : part}</Fragment>
  })
}

/** The move in flight: rises in, then shimmers (thinking state) until the move's
 *  own event takes its place. */
export function MovingSessionLine({ label }: { label: string }) {
  return (
    <PlanRevealSection revealKey={label}>
      <div role="status">
        <Rule>
          <LoadingText>{t('Moving this agent to {label}…', { label })}</LoadingText>
        </Rule>
      </div>
    </PlanRevealSection>
  )
}

/** Fork destinations are private to their creator, so only they get Open. */
function ForkedLine({
  event,
  title,
  teamId,
  onOpenNuphosLink,
}: {
  event: AgentTimelineEvent & { actor: NonNullable<AgentTimelineEvent['actor']> }
  title: string
  teamId?: string
  onOpenNuphosLink?: (href: string) => boolean
}) {
  const viewerId = useCurrentUser()?.id
  const forkUrl =
    teamId && event.forkSessionId && viewerId === event.actor.id
      ? toAbsoluteAtlasUrl(`/teams/${teamId}/agent/${event.forkSessionId}`)
      : null

  return (
    <Rule title={title}>
      {fill(
        event.kind === 'conversation_forked'
          ? t('{actor} forked this conversation')
          : t('{actor} edited a message and ran it in a new task'),
        {
          actor: <Person person={event.actor} />,
        },
      )}
      {forkUrl && onOpenNuphosLink && (
        <button
          type="button"
          onClick={() => onOpenNuphosLink(forkUrl)}
          className="shrink-0 font-medium text-secondary hover:underline"
        >
          {t('Open')}
        </button>
      )}
    </Rule>
  )
}
