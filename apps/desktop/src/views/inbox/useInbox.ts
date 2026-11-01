import { useEffect, useSyncExternalStore } from 'react'

import { api } from '../../api.ts'
import { onInputRequestsRefresh } from '../../lib/inputRequestRefresh.ts'

import { answeredIn, inboxCount } from './inboxItems.ts'

import type { AgentConversation } from '../../api/agent-types'

export const INBOX_POLL_MS = 15_000
// A reply the server took but has not applied yet (one queued behind a turn)
// stops hiding its question after this, so the badge falls back to the server.
const ANSWER_HOLD_MS = 60_000

// The one listing of conversations waiting on the viewer: the badge counts it,
// and the Inbox page publishes the list it shows into it, so the two agree.
let listing: { teamId: string; conversations: AgentConversation[] } | null = null
// Questions answered on this device, hidden until a listing no longer has them
// open. Infinity while the reply is being sent; a deadline once it was.
const answered = new Map<string, number>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** The newest listing of the team's waiting conversations, from the badge or the Inbox page. */
export function publishInboxListing(teamId: string, conversations: AgentConversation[]) {
  for (const id of answeredIn(conversations, answered, Date.now())) answered.delete(id)
  listing = { teamId, conversations }
  emit()
}

/**
 * Hides the question a reply answers from the badge while `send` is under way,
 * and after it succeeds until the server agrees. A failed send shows it again.
 */
export function answeringInbox<T>(requestId: string | undefined, send: Promise<T>): Promise<T> {
  if (!requestId) return send
  answered.set(requestId, Infinity)
  emit()
  const settle = (sent: boolean) => {
    if (!answered.has(requestId)) return
    if (sent) answered.set(requestId, Date.now() + ANSWER_HOLD_MS)
    else answered.delete(requestId)
    emit()
  }

  send.then(
    () => settle(true),
    () => settle(false),
  )

  return send
}

/** How many of the viewer's conversations wait on them in this team; `null` until known. */
export function inboxCountFor(teamId: string): number | null {
  return listing?.teamId === teamId ? inboxCount(listing.conversations, answered) : null
}

/** {@link inboxCountFor}, kept current by polling and by every answer or question. */
export function useInboxCount(teamId: string): number | null {
  useEffect(() => {
    if (!teamId) return
    let live = true
    let requested = 0
    let landed = 0
    const load = () => {
      const requestNo = ++requested

      api
        .agentListConversations(teamId, { pendingDecision: true, archived: 'exclude', limit: 100 })
        .then(
          (page) => {
            // A slow older request must not replace a newer listing.
            if (!live || requestNo < landed) return
            landed = requestNo
            publishInboxListing(teamId, page.conversations)
          },
          () => {
            // Best effort: keep what is already shown.
          },
        )
    }

    load()
    const interval = setInterval(load, INBOX_POLL_MS)
    // The same moments the Inbox page reloads on: a question asked, answered or dismissed.
    const stopRefresh = onInputRequestsRefresh(load)

    return () => {
      live = false
      clearInterval(interval)
      stopRefresh()
    }
  }, [teamId])

  return useSyncExternalStore(subscribe, () => inboxCountFor(teamId))
}
