import { useState } from 'react'

import { Avatar } from '../../components/Avatar'
import { BadgeStatPicker } from '../../components/sidebar/BadgeStatPicker'
import { CharacterRing } from '../../components/sidebar/CharacterRing'
import { agentSessionsCacheKey } from '../../components/sidebar/state'
import { useBadgeReading, useBadgeStat } from '../../hooks/useBadgeStat'
import { readSwrCache } from '../../lib/swrCache'

import type { AgentConversation } from '../../api'
import type { AtlasTeam, UserInfo } from '../../types'

/**
 * Which one stat rings this workspace's icon in the person's sidebar. The choice is their
 * own; the numbers count this workspace.
 */
export function SidebarBadgeSection({
  user,
  team,
  onUserUpdated,
}: {
  user: UserInfo
  team: AtlasTeam
  onUserUpdated: (user: UserInfo) => void
}) {
  const { stat, pick, failed } = useBadgeStat(user, onUserUpdated)
  // The sessions the sidebar last loaded for this workspace, so the preview counts the same.
  const [sessions] = useState(
    () => readSwrCache<AgentConversation[]>(agentSessionsCacheKey(team.id)) ?? [],
  )
  const reading = useBadgeReading(stat, team.id, sessions)
  const icon = (
    <Avatar
      src={team.avatarUrl}
      name={team.name || 'Workspace'}
      size={40}
      className="rounded-md !shadow-none"
    />
  )

  return (
    <section aria-labelledby="sidebar-badge" className="mt-10">
      <h2 id="sidebar-badge" className="text-[15px] font-semibold text-main">
        Sidebar badge
      </h2>
      <p className="mt-1 text-[13px] text-tertiary">
        Only you see this choice. A number on this workspace's icon at the top of your sidebar.
      </p>
      <div className="mt-4 rounded-xl border border-zGray-800 p-4">
        <div className="mb-4 flex items-center gap-3.5">
          <span className="relative flex-none" aria-hidden>
            {stat === 'none' ? (
              icon
            ) : (
              <CharacterRing
                size={52}
                stroke={3}
                fallback={icon}
                fraction={reading.fraction}
                square
              />
            )}
            {stat !== 'none' && reading.badge && (
              <span className="absolute -bottom-1 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-zViolet-500 px-1.5 text-[11px] font-bold tabular-nums leading-none text-white">
                {reading.badge}
              </span>
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-main">
              {team.name || 'Workspace'}
            </div>
            <div className="text-[12px] text-secondary">{reading.summary}</div>
          </div>
        </div>
        <BadgeStatPicker value={stat} failed={failed} onPick={(next) => void pick(next)} />
      </div>
    </section>
  )
}
