import { useAgentAvatarPick } from '../../lib/agentAvatarChoices'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { botAvatarFile } from '../../lib/botAvatars'
import { runtimeTurnActive } from '../../lib/runtimeExecution'

import { BotAvatarImage } from './BotAvatarImage'
import { AgentProviderIcon } from './panel/icons'

import type { AgentProvider } from '../../types/runtime'

/**
 * A Bot wears its face; a Task (no avatar) shows its Runtime's icon. The face
 * stays stable when the title or Runtime changes.
 */
export function AgentAvatar({
  agentId,
  avatar,
  provider,
  size = 24,
  sidebar = false,
  animated = false,
  face = true,
  bare = false,
}: {
  agentId: string
  /** The picked avatar as last fetched; a newer pick seen anywhere in the app wins. */
  avatar?: string
  provider?: AgentProvider | null
  size?: number
  sidebar?: boolean
  /** Loops the idle loop while this agent has a running turn. Message rows keep it off; hover still plays it once. */
  animated?: boolean
  /** False: only the Runtime icon, in main's sidebar box (a Tasks row). */
  face?: boolean
  /** The face alone, at any size: no runtime badge, as a sidebar row shows it. */
  bare?: boolean
}) {
  const seen = useAgentAvatarPick(agentId)
  const picked = face ? (seen === undefined ? avatar : seen) : undefined
  const running = runtimeTurnActive(useAgentRuntimeStates().get(agentId))
  // A sidebar row shows one clean face, as the iOS list does: no runtime badge.
  const clean = sidebar || bare
  // A face takes the Bots list's 36px; a Runtime icon a Tasks row's 22px.
  const sidebarSize = face ? 36 : 22
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
      {picked ? (
        <>
          <BotAvatarImage
            file={botAvatarFile(agentId, picked)}
            looping={animated && running}
            className="absolute left-0 top-0 object-contain"
            style={{ width: box, height: box }}
          />
          {!clean && (
            <span
              className="absolute bottom-0 right-0 flex items-center justify-center rounded-full bg-main p-px text-secondary"
              style={{ width: badge, height: badge }}
            >
              {runtime}
            </span>
          )}
        </>
      ) : (
        <span className="inline-flex size-4">{runtime}</span>
      )}
    </span>
  )
}
