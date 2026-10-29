// A send to an agent someone was asked to sign in waits in the session queue for them.
import { openSignInRequest } from '@/lib/agent/sign-in-request'

import { admitQueueableChat } from './session-queue-turn'

import type { QueueableChat } from './session-queue-turn'

/** What the sender is told while the message waits. */
export type SignInWait = { waiting: 'sign_in'; message: string }

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
    message: `Waiting for ${ask.askedName} to sign in. Your message is sent once they do.`,
  }
}
