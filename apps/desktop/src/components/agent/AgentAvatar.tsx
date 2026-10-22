import { MessageSquare } from 'lucide-react'

import { useAgentAppearance } from '../../lib/agentAppearance'
import { botAvatarUrl } from '../../lib/botAvatars'

import { AgentProviderIcon } from './panel/icons'

import type { AgentProvider } from '../../types/runtime'

/** Agent identity stays stable when its title or Runtime changes. */
export function AgentAvatar({
  agentId,
  provider,
  attached = true,
  size = 24,
  sidebar = false,
}: {
  agentId: string
  provider?: AgentProvider | null
  attached?: boolean
  size?: number
  sidebar?: boolean
}) {
  const { botAvatars, density } = useAgentAppearance()
  const sidebarSize = density === 'compact' ? 22 : 30
  const box = sidebar ? sidebarSize : size
  const badge = box <= 24 ? 9 : 12
  const runtime = attached ? (
    <AgentProviderIcon provider={provider} style={{ width: '100%', height: '100%' }} />
  ) : (
    <MessageSquare style={{ width: '100%', height: '100%' }} />
  )

  return (
    <span
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center justify-center align-middle"
      style={{ width: box, height: box }}
    >
      {botAvatars ? (
        <>
          <img
            src={botAvatarUrl(agentId)}
            alt=""
            draggable={false}
            className="absolute left-0 top-0 object-contain"
            style={{ width: box - 4, height: box - 4 }}
          />
          <span
            className="absolute bottom-0 right-0 flex items-center justify-center rounded-full bg-main p-px text-secondary ring-1 ring-main"
            style={{ width: badge, height: badge }}
          >
            {runtime}
          </span>
        </>
      ) : (
        <span className="inline-flex size-4">{runtime}</span>
      )}
    </span>
  )
}
