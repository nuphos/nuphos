// A send to an agent someone was asked to sign in waits in the session queue for them.
import { openSignInRequest } from '@/lib/agent/sign-in-request'

import { admitQueueableChat } from './session-queue-turn'

import type { QueueableChat } from './session-queue-turn'

/** What the sender is told while the message waits. */
export type SignInWait = { waiting: 'sign_in'; message: string; askedName: string }

/** A send the queue holds: for an offline computer (null) or a sign-in. */
export type QueuedSend = SignInWait | null

export function isQueued<T extends object>(runtime: T | QueuedSend): runtime is QueuedSend {
  return runtime === null || 'waiting' in runtime
}

export function queuedReply(streamId: string, wait: QueuedSend) {
  return {
    status: 'queued' as const,
    streamId,
    // The desktop names who the message waits for in its own language.
    ...(wait ? { message: wait.message, waitingFor: wait.askedName } : {}),
  }
}

/**
 * Held in the queue, which starts it once anyone signs the agent in
 * (sign-in-settle). Undefined when nothing was asked, or the send is not one
 * the queue holds (a continuation, a reply), so it runs as usual.
 */
export async function queueForSignIn(
  args: Omit<QueueableChat, 'snapshot' | 'runtimeOffline'>,
): Promise<SignInWait | undefined> {
  const ask = openSignInRequest(args.conversation)

  if (!ask) return undefined
  const queued = await admitQueueableChat({ ...args, snapshot: undefined, runtimeOffline: true })

  if (queued?.mode !== 'queued') return undefined

  return {
    waiting: 'sign_in',
    askedName: ask.askedName,
    message: `Waiting for ${ask.askedName} to sign in. Your message is sent once they do.`,
  }
}
