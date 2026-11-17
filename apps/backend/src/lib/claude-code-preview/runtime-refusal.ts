import { AppError } from '@/lib/errors'

import { agentHostAway } from './openab-acp-connect'
import { turnFailureCause } from './openab-acp-errors'

/**
 * The runtime will not take this message now: admission saw it busy, or another
 * turn (a delegated thread, a background-task continuation) took it after
 * admission. Clients that resend keep the message and send it again.
 */
export const refusal = (label: string) => new AppError(409, 'runtime_not_accepting_message', label)

export const isRuntimeRefusal = (error: unknown) =>
  error instanceof AppError && error.code === 'runtime_not_accepting_message'

/**
 * Whether the queue sends this turn again, so it is not recorded: a refusal for a
 * client that resends, or an agent host away or offline that the conversation queue waits for.
 */
export const resentAfter = (
  error: unknown,
  turn: { clientResendsRefusal?: boolean; queued?: unknown },
) =>
  ((turn.clientResendsRefusal || Boolean(turn.queued)) && isRuntimeRefusal(error)) ||
  (Boolean(turn.clientResendsRefusal) &&
    (agentHostAway(error) || turnFailureCause(error) === 'offline'))

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

/** The conversation's agent is not in the workspace any more: only moving it helps. */
export const runtimeGone = () =>
  new AppError(
    404,
    'runtime_not_found',
    'This agent is no longer available in this workspace. Move this conversation to another agent to continue.',
  )
