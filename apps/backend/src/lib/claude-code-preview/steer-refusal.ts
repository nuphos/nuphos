import { AppError } from '@/lib/errors'

import { OpenAbRpcError } from './openab-acp-errors'

/** openab's code when its own check finds the turn no longer takes steering. */
const STEER_UNAVAILABLE_CODE = -32004

const refusal = (details: Record<string, unknown>) =>
  new AppError(
    409,
    'runtime_steering_unavailable',
    'The turn already ended. Your message was not sent; send it as a new turn.',
    details,
  )

/**
 * The refusal for a steer the runtime did not inject into the running turn, or
 * undefined when it did. The adapter's own outcome and reason travel as details.
 */
export function steerNotInjected(result: Record<string, unknown>): AppError | undefined {
  if (result.outcome === 'injected') return undefined

  return refusal({ outcome: result.outcome, reason: result.reason })
}

/**
 * The same refusal when the runtime turns the steer away before the adapter sees it:
 * the turn can end between our check and the runtime's. Any other error is returned as is.
 */
export function steerRejected(error: unknown): unknown {
  return error instanceof OpenAbRpcError && error.code === STEER_UNAVAILABLE_CODE
    ? refusal({ reason: error.message })
    : error
}
