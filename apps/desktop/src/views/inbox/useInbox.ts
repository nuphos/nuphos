import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { api } from '../../api.ts'
import { cardReplyId } from '../../components/agent/panel/replyTarget.ts'
import { refreshInputRequests } from '../../lib/inputRequestRefresh.ts'

import { answeredIn, inboxCount } from './inboxItems.ts'
import { inboxListingQuery } from './inboxListing.ts'

import type { DecisionAnswer } from '../../api/agent-chat-types'
import type { AgentConversation } from '../../api/agent-types'
import type { DecisionCardRef, ReplyQuestion } from '../../components/agent/panel/replyTarget.ts'

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
 * Sends a secure card's "saved to" line as the viewer's own message in the
 * conversation that asked: the agent reads the file's path from it. The card
 * leaves at once; if the turn cannot start, it comes back with the error.
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
 * Answers an open question: the server wakes the agent that asked with the
 * answer, and no message is sent. The card leaves at once; if the answer is
 * refused, it comes back with the error.
 */
export function answerDecision(
  teamId: string | undefined,
  sessionId: string,
  requestId: string,
  answer: DecisionAnswer,
): Promise<boolean> {
  return answeringInbox(
    requestId,
    api.agentAnswerDecision(sessionId, requestId, teamId, answer).then(() => {
      refreshInputRequests()
    }),
  ).then(
    () => true,
    // Shown on the question's card, which is back in its list.
    () => false,
  )
}

/**
 * Dismisses an open question: the server closes it and tells the agent that
 * asked who dismissed it, and why when `reason` is given. Hidden like an
 * answer, and back with why if refused.
 */
export function dismissDecision(
  teamId: string | undefined,
  sessionId: string,
  requestId: string,
  reason?: string,
): Promise<boolean> {
  return answeringInbox(
    requestId,
    api.agentResolveDecision(sessionId, requestId, teamId, 'dismissed', reason).then(() => {
      refreshInputRequests()
    }),
  ).then(
    () => true,
    () => false,
  )
}

/** An Inbox question's reply waiting out its Undo window: an answer, or its dismissal. */
export type HeldReply = DecisionAnswer | { dismissed: true; reason?: string }

/** How long an Inbox answer waits, its question already gone, before it is sent: its Undo window. */
export const ANSWER_UNDO_MS = 5_000

// The one Inbox answer waiting out its Undo window: sent with true, undone with false.
let held: ((send: boolean) => boolean) | undefined

/** Sends the Inbox answer waiting out its Undo window now, if there is one. */
export function sendHeldAnswer() {
  held?.(true)
}

// Closing the window must not lose an answer the viewer already gave.
if (typeof window !== 'undefined') window.addEventListener('pagehide', sendHeldAnswer)

/**
 * Answers an Inbox question after {@link ANSWER_UNDO_MS}: it leaves at once, and
 * the returned undo brings it back unsent until then, and says whether it did. The answer still waiting
 * goes at once when another is given, or with {@link sendHeldAnswer}. The viewer has moved on by
 * the time it is sent, so `onFailed` hears why it was refused.
 */
export function holdAnswer(
  teamId: string,
  sessionId: string,
  requestId: string,
  answer: HeldReply,
  onFailed: (reason: string | undefined) => void,
): () => boolean {
  sendHeldAnswer()
  answered.set(requestId, Infinity)
  failures.delete(requestId)
  emit()
  const finish = (send: boolean): boolean => {
    clearTimeout(timer)
    if (held !== finish) return false
    held = undefined
    if (send)
      void (
        'dismissed' in answer
          ? dismissDecision(teamId, sessionId, requestId, answer.reason)
          : answerDecision(teamId, sessionId, requestId, answer)
      ).then((ok) => {
        if (!ok) onFailed(failures.get(requestId))
      })
    else if (answered.delete(requestId)) emit()

    return true
  }
  const timer = setTimeout(() => finish(true), ANSWER_UNDO_MS)

  held = finish

  return () => finish(false)
}

/** A conversation's cards answered through the server, each naming the open request it shows. */
export function cardAnswers(
  teamId: string | undefined,
  sessionId: string,
  questions: readonly ReplyQuestion[] | undefined,
) {
  return (answer: DecisionAnswer, card: DecisionCardRef) =>
    answerDecision(teamId, sessionId, cardReplyId(card, questions), answer)
}

/** Why the last answer to this question failed, until it is answered again. */
export function useAnswerFailure(requestId: string): string | undefined {
  return useSyncExternalStore(subscribe, () => failures.get(requestId))
}

/**
 * The team's waiting conversations: the one listing the badge counts and the Inbox lists,
 * polled also in the background. A new `reloadKey` reloads it at once.
 */
export function useInboxListing(teamId: string, reloadKey?: unknown) {
  const listing = useQuery({
    ...inboxListingQuery(teamId),
    enabled: Boolean(teamId),
    refetchInterval: INBOX_POLL_MS,
    // A retry would pause until the window is focused; the next poll is the retry.
    retry: false,
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
