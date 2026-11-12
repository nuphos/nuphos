import { queryOptions, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { api } from '../../api.ts'
import { onInputRequestsRefresh } from '../../lib/inputRequestRefresh.ts'
import { queryClient } from '../../lib/query/client.ts'
import { queryKeys } from '../../lib/query/keys.ts'

import { answeredIn, inboxCount } from './inboxItems.ts'

import type { AgentConversation } from '../../api/agent-types'

export const INBOX_POLL_MS = 15_000
// A reply the server took but has not applied yet (one queued behind a turn)
// stops hiding its question after this, so the badge falls back to the server.
const ANSWER_HOLD_MS = 60_000

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

/** Lets a newer listing settle the questions answered on this device that it has closed. */
export function settleAnswers(conversations: readonly AgentConversation[]) {
  const settled = answeredIn(conversations, answered, Date.now())

  for (const id of settled) answered.delete(id)
  if (settled.length > 0) emit()
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

export const inboxListingQuery = (teamId: string) =>
  queryOptions({
    queryKey: queryKeys.inbox(teamId),
    queryFn: () => listPending(teamId),
    staleTime: 0,
  })

// The moments a question may have been asked, answered or dismissed reload the listing shown.
const reloadListings = () =>
  void queryClient.invalidateQueries(
    { predicate: (query) => query.queryKey[0] === 'team' && query.queryKey[2] === 'inbox' },
    { cancelRefetch: false },
  )

onInputRequestsRefresh(reloadListings)

/**
 * The team's waiting conversations: the one listing the badge counts and the Inbox lists,
 * polled also in the background. A new `reloadKey` reloads it at once.
 */
export function useInboxListing(teamId: string, reloadKey?: unknown) {
  const listing = useQuery({
    ...inboxListingQuery(teamId),
    enabled: Boolean(teamId),
    refetchInterval: INBOX_POLL_MS,
    refetchIntervalInBackground: true,
  })
  const { refetch } = listing
  const shownKey = useRef(reloadKey)

  useEffect(() => {
    if (Object.is(shownKey.current, reloadKey)) return
    shownKey.current = reloadKey
    if (teamId) void refetch()
  }, [reloadKey, teamId, refetch])

  return listing
}

/** How many questions wait on the viewer in this team, settling this device's answers. */
export function useInboxCount(teamId: string): number {
  const { data: listing, dataUpdatedAt } = useInboxListing(teamId)
  const onDevice = useAnsweredOnDevice()

  // On every read, not only a changed one: an answer's hold can expire under the same listing.
  useEffect(() => {
    if (listing) settleAnswers(listing)
  }, [listing, dataUpdatedAt])

  return listing ? inboxCount(listing, onDevice) : 0
}

/** The questions answered on this device that a listing may still show open. */
export function answeredOnDevice(): ReadonlyMap<string, number> {
  return answered
}

/** {@link answeredOnDevice}, rendering again when it changes. */
export function useAnsweredOnDevice(): ReadonlyMap<string, number> {
  useSyncExternalStore(subscribe, () => version)

  return answered
}
