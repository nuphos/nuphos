import { useEffect, useSyncExternalStore } from 'react'

import { api } from '../../api.ts'
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
// Why an answer sent from this device failed, by question, shown on its card.
const failures = new Map<string, string>()
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
 * Hides the question a reply answers everywhere it is listed while `send` is
 * under way, and after it succeeds until the server agrees. A failed send shows
 * it again, with why it failed.
 */
export function answeringInbox<T>(requestId: string | undefined, send: Promise<T>): Promise<T> {
  if (!requestId) return send
  answered.set(requestId, Infinity)
  failures.delete(requestId)
  emit()
  send.then(
    () => {
      if (!answered.has(requestId)) return
      answered.set(requestId, Date.now() + ANSWER_HOLD_MS)
      emit()
    },
    (error: unknown) => {
      answered.delete(requestId)
      failures.set(requestId, error instanceof Error ? error.message : String(error))
      emit()
    },
  )

  return send
}

/**
 * Answers an open question with `text`, as the viewer's own message in the
 * conversation that asked: the reply chips of a card. The card leaves at once;
 * if the turn cannot start, it comes back with the error.
 */
export function answerQuestion(
  teamId: string,
  sessionId: string,
  requestId: string,
  text: string,
): Promise<void> {
  const streamId = crypto.randomUUID()
  const started = new Promise<void>((resolve, reject) => {
    // The first frame says whether the turn started; the rest is the agent's to stream.
    const stop = window.api.onAgentEvent(({ streamId: id, event }) => {
      if (id !== streamId) return
      stop()
      const failed = (event as { type?: string; error?: unknown }).type === 'error'

      if (failed) reject(new Error(String((event as { error?: unknown }).error)))
      else resolve()
    })

    window.api
      .agentStart({
        streamId,
        sessionId,
        teamId,
        decisionReplyTo: requestId,
        messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] }],
      })
      .catch((error: unknown) => {
        stop()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
  })

  return answeringInbox(requestId, started).catch(() => {
    // Shown on the question's card, which is back in its list.
  })
}

/**
 * Answers a Bot's own question with a post in its chat, where the Bot reads it:
 * the viewer's own message there. The card leaves at once; if the post fails, it
 * comes back with the error. Whether it was posted.
 */
export function answerInChat(
  teamId: string,
  chatId: string,
  requestId: string,
  text: string,
  id: string = crypto.randomUUID(),
): Promise<boolean> {
  const post = api.agentPostChannelMessage(
    chatId,
    teamId,
    text,
    id,
    undefined,
    undefined,
    undefined,
    requestId,
  )

  return answeringInbox(requestId, post).then(
    () => true,
    () => false,
  )
}

/** Why the last answer to this question failed, until it is answered again. */
export function useAnswerFailure(requestId: string): string | undefined {
  return useSyncExternalStore(subscribe, () => failures.get(requestId))
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
