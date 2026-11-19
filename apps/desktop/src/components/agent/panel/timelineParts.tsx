import { Avatar } from '../../Avatar'

import { AgentProviderIcon } from './icons'

import type { AgentTimelinePerson, AgentTimelineRuntime } from '../../../api/agent-types'
import type { ReactNode } from 'react'

export function Person({ person }: { person: AgentTimelinePerson }) {
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

export function Runtime({ runtime }: { runtime: AgentTimelineRuntime }) {
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
      className="flex min-w-0 items-center gap-1 overflow-hidden text-[11.5px] whitespace-nowrap text-tertiary"
      title={title}
    >
      {children}
    </div>
  )
}
