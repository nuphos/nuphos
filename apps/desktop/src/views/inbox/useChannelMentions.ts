import { useQuery } from '@tanstack/react-query'

import { api } from '../../api'
import { queryKeys } from '../../lib/query/keys'

import type { ChannelMention } from '../../api'

const MENTION_POLL_MS = 10_000

/**
 * Channels and shared agents where someone @mentioned the viewer since they last
 * posted there, or null before the first load. Posting there clears it. A failed
 * read keeps what is already shown.
 */
export function useChannelMentions(teamId: string): ChannelMention[] | null {
  const { data } = useQuery({
    queryKey: queryKeys.channelMentions(teamId),
    queryFn: async () => (await api.agentListChannelMentions(teamId)).mentions,
    refetchInterval: MENTION_POLL_MS,
    // A new one is notified, so it is read in the background too.
    refetchIntervalInBackground: true,
  })

  return data ?? null
}
