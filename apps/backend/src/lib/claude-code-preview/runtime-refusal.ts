import { AppError } from '@/lib/errors'

/**
 * The runtime will not take this message now: admission saw it busy, or another
 * turn (a delegated thread, a background-task continuation) took it after
 * admission. Clients that resend keep the message and send it again.
 */
export const refusal = (label: string) => new AppError(409, 'runtime_not_accepting_message', label)

export const isRuntimeRefusal = (error: unknown) =>
  error instanceof AppError && error.code === 'runtime_not_accepting_message'

/**
 * What the client hears about a refused turn that came from, or went back to,
 * the session queue: that the message waits there, not that it was refused.
 */
export const queuedRefusal = (error: unknown, queued: unknown) =>
  queued && isRuntimeRefusal(error)
    ? new AppError(409, 'message_queued', 'Your message waits for the turn ahead')
    : error

/** The message waits in the session queue: the expected outcome, not a failure. */
export const isMessageQueued = (error: unknown) =>
  error instanceof AppError && error.code === 'message_queued'

/**
 * The conversation's agent is not in the workspace any more, or not for this person: only
 * moving it helps. Removal and lost access read the same, so a computer no longer shared with
 * them is not revealed to still exist.
 */
export const runtimeGone = () =>
  new AppError(
    404,
    'runtime_not_found',
    'This agent is no longer available to you. It was removed, or the computer it runs on is no longer shared with you. Move this conversation to another agent to continue.',
  )
