import { useAgentAvatarBackground, useAgentAvatarPick } from '../../lib/agentAvatarChoices'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { trustedAvatarURL } from '../../lib/avatarUrl'
import { botAvatarBackgroundColor } from '../../lib/botAvatarBackgrounds'
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
  avatarBackground,
  provider,
  size = 24,
  sidebar = false,
  animated = false,
  face = true,
  showBadge = true,
  looping = false,
}: {
  agentId: string
  /** The picked avatar as last fetched; a newer pick seen anywhere in the app wins. */
  avatar?: string
  /** The tint its face sits on, as last fetched; like `avatar`, a newer one seen in the app wins. */
  avatarBackground?: string
  provider?: AgentProvider | null
  size?: number
  sidebar?: boolean
  /** Loops the idle loop while this agent has a running turn. Message rows keep it off; hover still plays it once. */
  animated?: boolean
  /** False: only the Runtime icon, in main's sidebar box (a Tasks row). */
  face?: boolean
  /** False inside a group chat's cluster, whose faces carry no badge. */
  showBadge?: boolean
  /** Loops the idle loop regardless of this agent's own turn (a Bot whose sub-agent works). */
  looping?: boolean
}) {
  const seen = useAgentAvatarPick(agentId)
  const picked = face ? (seen === undefined ? avatar : seen) : undefined
  const seenBackground = useAgentAvatarBackground(agentId)
  const background = seen === undefined ? avatarBackground : seenBackground
  const tint = botAvatarBackgroundColor(background)
  const running = runtimeTurnActive(useAgentRuntimeStates().get(agentId))
  const uploaded = trustedAvatarURL(picked)
  // A face takes the Bots list's 36px; a Runtime icon a Tasks row's 22px.
  const sidebarSize = face ? 36 : 22
  const box = sidebar ? sidebarSize : size
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
          {uploaded ? (
            <img
              src={uploaded}
              alt=""
              className="absolute left-0 top-0 rounded-full object-cover"
              style={{ width: box, height: box }}
            />
          ) : (
            <>
              {/* Behind the character, unclipped: a head may break out of the disc. */}
              {tint && (
                <span
                  data-avatar-background={background ?? undefined}
                  className="absolute left-0 top-0 rounded-full"
                  style={{ width: box, height: box, background: tint }}
                />
              )}
              <BotAvatarImage
                file={botAvatarFile(agentId, picked)}
                looping={looping || (animated && running)}
                className="absolute left-0 top-0 object-contain"
                style={{ width: box, height: box }}
              />
            </>
          )}
          {showBadge && provider && <AgentRuntimeBadge provider={provider} size={box <= 24 ? 9 : 12} />}
        </>
      ) : (
        <span className="inline-flex size-4">{runtime}</span>
      )}
    </span>
  )
}

/** Decorative runtime disc on a Bot's face. */
function AgentRuntimeBadge({ provider, size }: { provider: AgentProvider; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-0 right-0 flex items-center justify-center rounded-full bg-main p-px text-secondary"
      style={{ width: size, height: size }}
    >
      <AgentProviderIcon provider={provider} style={{ width: '100%', height: '100%' }} />
    </span>
  )
}
