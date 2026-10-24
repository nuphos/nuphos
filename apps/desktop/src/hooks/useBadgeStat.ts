import { useEffect, useState } from 'react'

import { api } from '../api'
import { useAgentRuntimeStates } from '../lib/agentRuntimeStates'
import { DEFAULT_BADGE_STAT, readBadge } from '../lib/badgeStat'
import { BADGE_STAT_SLOT, pendingKey, pendingValue, saveValue } from '../lib/profilePickSync'

import { notifyPendingPick, usePendingValue } from './usePendingPick'
import { useRuntimeQuotas } from './useRuntimeQuotas'

import type { AgentConversation } from '../api'
import type { BadgeReading } from '../lib/badgeStat'
import type { BadgeStat, UserInfo } from '../types'

const MERGED_PRS_POLL_MS = 5 * 60_000

const send = (stat: BadgeStat) => api.authSetBadgeStat(stat)

/**
 * What the badge counts, saved on the person's account. Like the character, a pick shows
 * at once and stays on this computer until the server takes it.
 */
export function useBadgeStat(user: UserInfo, onUserUpdated: (user: UserInfo) => void) {
  const pending = usePendingValue(BADGE_STAT_SLOT, user.id)
  const [failed, setFailed] = useState(false)

  async function pick(stat: BadgeStat) {
    const outcome = saveValue(BADGE_STAT_SLOT, stat, user.id, { storage: localStorage, send })

    notifyPendingPick()
    const result = await outcome

    notifyPendingPick()
    setFailed(result.kind === 'failed')
    if (result.kind === 'saved') onUserUpdated(result.user)
  }

  // A pick kept here earlier goes up quietly once the server can take it.
  useEffect(() => {
    const waiting = pendingValue(BADGE_STAT_SLOT, localStorage, user.id)

    if (!waiting) return
    if (waiting === user.badgeStat) {
      localStorage.removeItem(pendingKey(BADGE_STAT_SLOT, user.id))
      notifyPendingPick()

      return
    }
    void saveValue(BADGE_STAT_SLOT, waiting, user.id, { storage: localStorage, send }).then(
      (result) => {
        notifyPendingPick()
        if (result.kind === 'saved') onUserUpdated(result.user)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per person, not on every pick
  }, [user.id])

  return { stat: pending ?? user.badgeStat ?? DEFAULT_BADGE_STAT, pick, failed }
}

/** PRs merged this month, read only while that is the stat shown. Null until known. */
function useMergedPrs(teamId: string | undefined, enabled: boolean): number | null {
  const [count, setCount] = useState<{ teamId: string; count: number | null }>()

  useEffect(() => {
    if (!enabled || !teamId) return
    let current = true
    const read = () =>
      api
        .authReadMergedPrs(teamId, Intl.DateTimeFormat().resolvedOptions().timeZone)
        .then((result) => {
          if (current) setCount({ teamId, count: result?.count ?? null })
        })
        .catch(() => {
          // Offline or a server error: the badge hides rather than guessing.
          if (current) setCount({ teamId, count: null })
        })
    const timer = window.setInterval(() => void read(), MERGED_PRS_POLL_MS)

    void read()

    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [teamId, enabled])

  return count && count.teamId === teamId ? count.count : null
}

/** The badge for `stat` from data the app already keeps: sessions, runtime states, quotas. */
export function useBadgeReading(
  stat: BadgeStat,
  teamId: string | undefined,
  sessions: readonly AgentConversation[],
): BadgeReading {
  const runtimeStates = useAgentRuntimeStates()
  const quotas = useRuntimeQuotas(stat === 'quota' ? teamId : undefined)
  const mergedPrs = useMergedPrs(teamId, stat === 'merged-prs')

  return readBadge(stat, { sessions, runtimeStates, quotas, mergedPrs })
}
