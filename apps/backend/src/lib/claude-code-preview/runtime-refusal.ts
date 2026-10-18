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
