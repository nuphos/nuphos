import { useBadgeReading, useBadgeStat } from '../../hooks/useBadgeStat'
import { useCharacterPick } from '../../hooks/useProfileCharacter'

import { CharacterRing } from './CharacterRing'

import type { AgentConversation } from '../../api'
import type { UserInfo } from '../../types'
import type { ReactNode } from 'react'

/**
 * The workspace icon in the sidebar's workspace row, in a thin ring with a badge for the
 * one stat the person picked in Team settings › General. It only displays: clicking it
 * opens the workspace menu. With no stat picked to show, it is the plain icon.
 */
export function WorkspaceBadge({
  user,
  icon,
  teamId,
  sessions = [],
  onUserUpdated,
}: {
  user: UserInfo
  /** The workspace icon exactly as the switcher shows it: a logo or initials. */
  icon: ReactNode
  teamId?: string
  /** This workspace's sessions, as the sidebar lists them. */
  sessions?: readonly AgentConversation[]
  onUserUpdated: (user: UserInfo) => void
}) {
  // Both also send up a pick kept on this computer once the server can take it; the
  // character itself shows in the account row at the bottom of the sidebar.
  const { stat } = useBadgeStat(user, onUserUpdated)

  useCharacterPick(user, onUserUpdated)
  const reading = useBadgeReading(stat, teamId, sessions)

  if (stat === 'none') return <>{icon}</>

  return (
    <span className="relative flex-none" title={reading.summary}>
      <CharacterRing size={26} stroke={2} fallback={icon} fraction={reading.fraction} square />
      {reading.badge && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-zViolet-500 px-[3px] text-[9px] font-bold tabular-nums leading-none text-white"
        >
          {reading.badge}
        </span>
      )}
    </span>
  )
}
