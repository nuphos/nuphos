import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { AppError } from '@/lib/errors'

import { OUTDATED_HOST_HINT, hostOutdated, updateAvailable } from './host-minimum-version'
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

/**
 * A failed turn on a computer below the support floor, or with a newer Nuphos waiting, says so:
 * the error is the one thing every client shows, old ones included. A refusal stays as it is.
 */
export async function noteOutdated(
  error: unknown,
  local: { userId: string; deviceId: string } | undefined,
): Promise<void> {
  if (!local || !(error instanceof Error) || isRuntimeRefusal(error)) return
  const behind = await runtimePresenceStore()
    .get(local.userId, local.deviceId)
    .then(async (present) => Boolean(hostOutdated(present)) || (await updateAvailable(present)))
    .catch(() => false)

  if (behind) error.message += `\n\n${OUTDATED_HOST_HINT}`
}

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
