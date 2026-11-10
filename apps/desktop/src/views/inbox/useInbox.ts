import { useEffect, useSyncExternalStore } from 'react'

import { api } from '../../api.ts'
import { toast } from '../../components/ui/toast.ts'
import { t } from '../../i18n/index.ts'
import { onInputRequestsRefresh } from '../../lib/inputRequestRefresh.ts'

import { answeredIn, inboxCount } from './inboxItems.ts'

import type { AgentConversation } from '../../api/agent-types'

export const INBOX_POLL_MS = 15_000
// A reply the server took but has not applied yet (one queued behind a turn)
// stops hiding its question after this, so the badge falls back to the server.
const ANSWER_HOLD_MS = 60_000

// The one listing of the team's conversations with an open question that the
// viewer may read: the Inbox and its badge take the viewer's own, a Task page
// and a Bot's chat those the viewer may reply in.
let listing: { teamId: string; conversations: AgentConversation[] } | null = null
// The team whose last load failed, until a listing lands again.
let failedTeamId: string | null = null
// Questions answered on this device, hidden until a listing no longer has them
// open. Infinity while the reply is being sent; a deadline once it was.
const answered = new Map<string, number>()
const listeners = new Set<() => void>()
// Bumped on every change, so a reader of `answered` renders again when it does.
let version = 0

function emit() {
  version += 1
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
  failedTeamId = null
  emit()
}

/**
 * Hides the question a reply answers from the badge while `send` is under way,
 * and after it succeeds until the server agrees. A failed send shows it again.
 * A reply `queued` behind a running turn says so, since its question is gone.
 */
export function answeringInbox<T>(
  requestId: string | undefined,
  send: Promise<T>,
  queued = false,
): Promise<T> {
  if (!requestId) return send
  answered.set(requestId, Infinity)
  emit()
  const settle = (sent: boolean) => {
    if (!answered.has(requestId)) return
    if (sent) answered.set(requestId, Date.now() + ANSWER_HOLD_MS)
    else answered.delete(requestId)
    emit()
    if (sent && queued)
      toast.info(t('Answer queued'), t('The agent will see it after its current step.'))
  }

  send.then(
    () => settle(true),
    () => settle(false),
  )

  return send
}

/** How many questions wait on the viewer in this team; `null` until known. */
export function inboxCountFor(teamId: string): number | null {
  return listing?.teamId === teamId ? inboxCount(listing.conversations, answered) : null
}

// Bounded, as the other listings are: a cursor never repeats a page.
const MAX_PAGES = 10

/** Every page of the team's readable conversations with an open question. */
async function listPending(teamId: string): Promise<AgentConversation[]> {
  const conversations: AgentConversation[] = []
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const listed = await api.agentListConversations(teamId, {
      scope: 'team',
      pendingDecision: true,
      archived: 'exclude',
      limit: 100,
      cursor,
    })

    conversations.push(...listed.conversations)
    const next = listed.nextCursor ?? undefined

    if (!next || next === cursor) break
    cursor = next
  }

  return conversations
}

/**
 * The team's waiting conversations, `null` until listed: the one listing the
 * badge counts and the Inbox lists, kept current by polling every `pollMs` and
 * by every answer or question. A new `reloadKey` reloads it at once.
 */
export function useInboxListing(
  teamId: string,
  pollMs = INBOX_POLL_MS,
  reloadKey: unknown = 0,
): AgentConversation[] | null {
  useEffect(() => {
    if (!teamId) return
    let live = true
    let requested = 0
    let landed = 0
    const load = () => {
      const requestNo = ++requested

      listPending(teamId).then(
        (conversations) => {
          // A slow older request must not replace a newer listing.
          if (!live || requestNo < landed) return
          landed = requestNo
          publishInboxListing(teamId, conversations)
        },
        () => {
          // Keep what is already shown, and say the list may be stale.
          if (!live || failedTeamId === teamId) return
          failedTeamId = teamId
          emit()
        },
      )
    }

    load()
    const interval = setInterval(load, pollMs)
    // The moments a question may have been asked, answered or dismissed.
    const stopRefresh = onInputRequestsRefresh(load)

    window.addEventListener('focus', load)

    return () => {
      live = false
      clearInterval(interval)
      stopRefresh()
      window.removeEventListener('focus', load)
    }
  }, [teamId, pollMs, reloadKey])

  return useSyncExternalStore(subscribe, () =>
    listing?.teamId === teamId ? listing.conversations : null,
  )
}

/** Whether the last load of the team's listing failed, so what is shown may be stale. */
export function useInboxListingFailed(teamId: string): boolean {
  return useSyncExternalStore(subscribe, () => failedTeamId === teamId)
}

/** {@link inboxCountFor}, kept current by {@link useInboxListing}. */
export function useInboxCount(teamId: string): number | null {
  useInboxListing(teamId)

  return useSyncExternalStore(subscribe, () => inboxCountFor(teamId))
}

/** The questions answered on this device that a listing may still show open. */
export function useAnsweredOnDevice(): ReadonlyMap<string, number> {
  useSyncExternalStore(subscribe, () => version)

  return answered
}
