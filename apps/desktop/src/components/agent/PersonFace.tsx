import clsx from 'clsx'

import { Avatar } from '../Avatar'

import { AgentAvatar } from './AgentAvatar'

import type { AgentFace } from '../../api/agent-types'
import type { TeamMember } from '../../types'

/** A teammate, or an agent counted as one; the id of an agent is its session's. */
export type Pickable = Pick<TeamMember, 'id' | 'name' | 'email' | 'avatarURL'> & {
  agent?: AgentFace
}

/** The face of a person, a person's photo or an agent's avatar on a disc of the same size. */
export function PersonFace({
  person,
  size,
  className,
}: {
  person: Pickable
  size: number
  className?: string
}) {
  if (!person.agent)
    return <Avatar src={person.avatarURL} name={person.name} size={size} className={className} />

  return (
    <span
      className={clsx(
        'relative inline-flex shrink-0 items-center justify-center rounded-full bg-zGray-800',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <AgentAvatar
        agentId={person.id}
        avatar={person.agent.avatar}
        provider={person.agent.provider}
        size={size}
      />
    </span>
  )
}
