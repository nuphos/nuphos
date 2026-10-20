import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'

import { listingFor } from './inboxItems'

import type { InboxListing } from './inboxItems'

export const INBOX_POLL_MS = 15_000

/** How many of the viewer's conversations wait on them in this team; `null` until known. */
export function useInboxCount(teamId: string): number | null {
  const [listing, setListing] = useState<InboxListing | null>(null)
  const requested = useRef(0)

  useEffect(() => {
    if (!teamId) return
    let live = true
    const load = () => {
      const requestNo = ++requested.current

      api
        .agentListConversations(teamId, { pendingDecision: true, archived: 'exclude', limit: 100 })
        .then(
          (page) => {
            if (!live) return
            const next = { teamId, count: page.conversations.length, requestNo }

            // A slow older request must not replace a newer listing.
            setListing((prev) => (prev && prev.requestNo > requestNo ? prev : next))
          },
          () => {
            // Best effort: keep what is already shown.
          },
        )
    }

    load()
    const interval = setInterval(load, INBOX_POLL_MS)

    return () => {
      live = false
      clearInterval(interval)
    }
  }, [teamId])

  return listingFor(listing, teamId)?.count ?? null
}
