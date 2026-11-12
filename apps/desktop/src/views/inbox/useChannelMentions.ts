import { useQuery } from '@tanstack/react-query'

import { api } from '../../api'
import { queryKeys } from '../../lib/query/keys'

import type { ChannelMention } from '../../api'

const MENTION_POLL_MS = 10_000

/**
 * Channels and shared agents where someone @mentioned the viewer since they last
 * posted there, or null before the first load. Posting there clears it. Only the
 * always-mounted badge passes `poll`, also in the background since a new one is
 * notified; a failed read keeps what is already shown.
 */
export function useChannelMentions(teamId: string, { poll = false } = {}): ChannelMention[] | null {
  const { data } = useQuery({
    queryKey: queryKeys.channelMentions(teamId),
    queryFn: async () => (await api.agentListChannelMentions(teamId)).mentions,
    enabled: Boolean(teamId),
    refetchInterval: poll && MENTION_POLL_MS,
    refetchIntervalInBackground: poll,
  })

  return data ?? null
}
