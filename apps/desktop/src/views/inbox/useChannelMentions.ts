import { useEffect, useState } from 'react'

import { api } from '../../api'

import type { ChannelMention } from '../../api'

const MENTION_POLL_MS = 10_000

/**
 * Channels and shared agents where someone @mentioned the viewer since they last
 * posted there, or null before the first load. Posting there clears it.
 */
export function useChannelMentions(teamId: string) {
  const [mentions, setMentions] = useState<ChannelMention[] | null>(null)

  useEffect(() => {
    if (!teamId) return
    let live = true
    const load = () =>
      void api.agentListChannelMentions(teamId).then(
        (next) => {
          if (live) setMentions(next.mentions)
        },
        () => {
          // Best effort: keep what is already shown.
        },
      )

    load()
    const interval = setInterval(load, MENTION_POLL_MS)

    return () => {
      live = false
      clearInterval(interval)
      setMentions(null)
    }
  }, [teamId])

  return mentions
}
