import { getAgentDevice } from '@/lib/agent/devices/store'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { AppError } from '@/lib/errors'

import { CodexTurnFailedError } from './codex-turn-failure'
import { hostUpdateHint } from './host-minimum-version'
import { agentHostAway } from './openab-acp-connect'
import { claudeNotice, runtimeUsageExhaustedMessage, turnFailureCause } from './openab-acp-errors'

/**
 * The runtime will not take this message now: admission saw it busy, or another
 * turn (a delegated thread, a background-task continuation) took it after
 * admission. Clients that resend keep the message and send it again.
 */
export const refusal = (label: string) => new AppError(409, 'runtime_not_accepting_message', label)

export const isRuntimeRefusal = (error: unknown) =>
  error instanceof AppError && error.code === 'runtime_not_accepting_message'

/** Anthropic holds the account until its holder verifies it: no wait ends that. */
const VERIFICATION_HOLD = /^(?:API Error: )?Your account can['’]t receive replies from Claude\b/u

/** Out of usage that the allowance resetting ends, unlike an account held for verification. */
export const outOfUsageUntilReset = (error: unknown) =>
  Boolean(runtimeUsageExhaustedMessage(error)) && !VERIFICATION_HOLD.test(claudeNotice(error) ?? '')

/** The provider still answered 429 after the agent's own retries: like a busy runtime, it passes. */
export const providerRateLimited = (error: unknown) =>
  error instanceof CodexTurnFailedError && /\b429\b/u.test(error.notice)

/** A turn the runtime or its provider will take later: a busy runtime, or a provider rate limit. */
export const refusedForNow = (error: unknown) =>
  isRuntimeRefusal(error) || providerRateLimited(error)

/**
 * Whether the queue sends this turn again, so it is not recorded: a refusal for a
 * client that resends, an agent host away or offline or a provider rate limit that the
 * conversation queue waits for, or an agent out of usage that a queued turn waits for.
 * A direct send says so at once.
 */
export const resentAfter = (
  error: unknown,
  turn: {
    clientResendsRefusal?: boolean
    waitsOutUsage?: boolean
    queued?: unknown
    direct?: boolean
  },
) =>
  ((turn.clientResendsRefusal || Boolean(turn.queued)) && isRuntimeRefusal(error)) ||
  ((turn.waitsOutUsage || (Boolean(turn.queued) && !turn.direct)) && outOfUsageUntilReset(error)) ||
  (Boolean(turn.clientResendsRefusal) &&
    (agentHostAway(error) || turnFailureCause(error) === 'offline' || providerRateLimited(error)))

/**
 * What the client hears about a refused turn that came from, or went back to,
 * the session queue: that the message waits there, not that it was refused.
 */
export const queuedRefusal = (error: unknown, requeued: boolean) =>
  requeued ? new AppError(409, 'message_queued', 'Your message waits for the turn ahead') : error

/**
 * A failed turn on a computer below the support floor says so: the error is the one thing every
 * client shows, old ones included. A newer release alone is no cause: most failures, a timeout
 * among them, are not fixed by updating. A refusal stays as it is,
 * and so does a sign-in or usage failure, whose fix is not an update.
 */
export async function noteOutdated(
  error: unknown,
  local: { userId: string; deviceId: string } | undefined,
): Promise<void> {
  if (!local || !(error instanceof Error) || isRuntimeRefusal(error)) return
  if (['auth', 'usage_limit'].includes(turnFailureCause(error))) return
  const hint = await runtimePresenceStore()
    .get(local.userId, local.deviceId)
    .then(async (presence) => {
      const device = await getAgentDevice(local.userId, local.deviceId).catch(() => null)

      return hostUpdateHint(presence, device?.label)
    })
    .catch(() => undefined)

  if (hint) error.message += `${/[.!?]$/u.test(error.message) ? '' : '.'}\n\n${hint}`
}

/** The message waits in the session queue: the expected outcome, not a failure. */
export const isMessageQueued = (error: unknown) =>
  error instanceof AppError && error.code === 'message_queued'

/**
 * The conversation's runtime is not in the workspace any more, or not for this person: only
 * moving it helps. Removal and lost access read the same, so a computer no longer shared with
 * them is not revealed to still exist.
 */
export const runtimeGone = () =>
  new AppError(
    404,
    'runtime_not_found',
    'This runtime is no longer available to you. It was removed, or the computer it runs on is no longer shared with you. Move this conversation to another runtime to continue.',
  )
