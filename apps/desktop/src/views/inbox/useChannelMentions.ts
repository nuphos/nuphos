import { useCallback, useSyncExternalStore } from 'react'

import { api } from '../../api'
import { pollSnapshot, subscribePoll } from '../../hooks/sharedPoll'

import type { ChannelMention } from '../../api'

const MENTION_POLL_MS = 10_000

/**
 * Channels and shared agents where someone @mentioned the viewer since they last
 * posted there, or null before the first load. Posting there clears it. One poll
 * per team serves every caller, also in the background since a new one is
 * notified; a failed read keeps what is already shown.
 */
export function useChannelMentions(teamId: string): ChannelMention[] | null {
  const key = teamId ? `channel-mentions:${teamId}` : undefined
  const subscribe = useCallback(
    (listener: () => void) =>
      key
        ? subscribePoll(
            key,
            async () => (await api.agentListChannelMentions(teamId)).mentions,
            MENTION_POLL_MS,
            listener,
            true,
          )
        : () => {},
    [teamId, key],
  )

  return useSyncExternalStore(subscribe, () => pollSnapshot<ChannelMention[]>(key)).value ?? null
}
