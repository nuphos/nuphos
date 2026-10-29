import { useAgentAppearance } from '../../lib/agentAppearance'
import { useAgentAvatarPick } from '../../lib/agentAvatarChoices'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { botAvatarFile } from '../../lib/botAvatars'
import { runtimeTurnActive } from '../../lib/runtimeExecution'

import { BotAvatarImage } from './BotAvatarImage'
import { AgentProviderIcon } from './panel/icons'

import type { AgentProvider } from '../../types/runtime'

/** Agent identity stays stable when its title or Runtime changes. */
export function AgentAvatar({
  agentId,
  avatar,
  provider,
  size = 24,
  sidebar = false,
  animated = false,
}: {
  agentId: string
  /** The picked avatar as last fetched; a newer pick seen anywhere in the app wins. */
  avatar?: string
  provider?: AgentProvider | null
  size?: number
  sidebar?: boolean
  /** Loops the idle loop while this agent has a running turn. Message rows keep it off; hover still plays it once. */
  animated?: boolean
}) {
  const { botAvatars, density } = useAgentAppearance()
  const seen = useAgentAvatarPick(agentId)
  const running = runtimeTurnActive(useAgentRuntimeStates().get(agentId))
  const sidebarSize = density === 'compact' ? 22 : 30
  const box = sidebar ? sidebarSize : size
  const badge = box <= 24 ? 9 : 12
  const runtime = (
    <AgentProviderIcon provider={provider} style={{ width: '100%', height: '100%' }} />
  )

  return (
    <span
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center justify-center align-middle"
      style={{ width: box, height: box }}
    >
      {botAvatars ? (
        <>
          <BotAvatarImage
            file={botAvatarFile(agentId, seen === undefined ? avatar : seen)}
            looping={animated && running}
            className="absolute left-0 top-0 object-contain"
            style={{ width: box, height: box }}
          />
          <span
            className="absolute bottom-0 right-0 flex items-center justify-center rounded-full bg-main p-px text-secondary"
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
