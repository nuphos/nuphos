import { Loader2 } from 'lucide-react'

import { Avatar } from '../../Avatar'

import { ClaudeCodeIcon, CodexIcon } from './icons'

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

/** One membership or runtime change, between the messages it happened among. */
export function TimelineEventLine({ event }: { event: AgentTimelineEvent }) {
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

export function MovingSessionLine({ label }: { label: string }) {
  return (
    <div role="status">
      <Rule>
        <Loader2 className="h-3 w-3 animate-spin" />
        Moving this session to {label}…
      </Rule>
    </div>
  )
}
