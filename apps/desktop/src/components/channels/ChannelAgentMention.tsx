import type { ChannelAgent } from '../../api'
import type { ReactNode } from 'react'

export function channelAgentMention(
  href: string,
  children: ReactNode,
  agents: ChannelAgent[],
  viewerId: string,
  onOpen: (id: string) => void,
): ReactNode | null {
  const agent = agents.find((item) => {
    const id = encodeURIComponent(`agent:${item.sessionId}`)

    return href === `#mention:${id}`
  })

  if (!agent) return null
  const className = 'inline rounded px-0.5 font-medium text-primary bg-state-selected'

  return agent.ownerId === viewerId ? (
    <button type="button" className={className} onClick={() => onOpen(agent.sessionId)}>
      {children}
    </button>
  ) : (
    <span className={className} title={agent.title}>
      {children}
    </span>
  )
}
