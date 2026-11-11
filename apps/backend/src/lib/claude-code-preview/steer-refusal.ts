import { AppError } from '@/lib/errors'

/**
 * The refusal for a steer the runtime did not inject into the running turn, or
 * undefined when it did. The adapter's own outcome and reason travel as details.
 */
export function steerNotInjected(result: Record<string, unknown>): AppError | undefined {
  if (result.outcome === 'injected') return undefined

  return new AppError(
    409,
    'runtime_steering_unavailable',
    'The turn already ended. Your message was not sent; send it as a new turn.',
    { outcome: result.outcome, reason: result.reason },
  )
}
