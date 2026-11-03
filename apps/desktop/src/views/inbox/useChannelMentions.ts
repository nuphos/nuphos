import { useEffect, useState } from 'react'

import { api } from '../../api'

import type { ChannelMention } from '../../api'

const MENTION_POLL_MS = 10_000

/**
 * Channels where someone @mentioned the viewer since they last posted there.
 * Posting in the channel clears it.
 */
export function useChannelMentions(teamId: string) {
  const [mentions, setMentions] = useState<ChannelMention[]>([])

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
      setMentions([])
    }
  }, [teamId])

  return mentions
}
