type ErrorObserver = (operation: string, error: unknown) => void
type InstrumentApiOptions = {
  stallAfterMs?: number
  /** Called when a call settles after `stallAfterMs`, with its real duration
   * and the rejection, if any, so the caller can tell slowness from an outage. */
  observeStall?: (operation: string, elapsedMs: number, error?: unknown) => void
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  )
}

/**
 * Wrap every renderer API method at the module boundary. A rejection remains
 * a rejection with the original value, but is observed before a view can turn
 * it into local state (or swallow it), so API failures cannot bypass Error
 * Tracking merely because a caller handled them.
 */
export function instrumentApi<T extends Record<string, unknown>>(
  methods: T,
  observeError: ErrorObserver,
  options: InstrumentApiOptions = {},
): T {
  const wrapped = Object.fromEntries(
    Object.entries(methods).map(([operation, value]) => {
      if (typeof value !== 'function') return [operation, value]
      const method = value as (...args: unknown[]) => unknown

      return [
        operation,
        (...args: unknown[]) => {
          let result: unknown

          try {
            result = method(...args)
          } catch (error) {
            observeError(operation, error)
            throw error
          }
          if (!isPromiseLike(result)) return result
          // Not Date.now(): on macOS and Linux this clock stops while the machine
          // sleeps, so a call spanning a sleep is not reported as a stall.
          const startedAt = performance.now()
          const { stallAfterMs, observeStall } = options
          const settled = (error?: unknown) => {
            const elapsedMs = performance.now() - startedAt

            if (stallAfterMs !== undefined && elapsedMs >= stallAfterMs) {
              observeStall?.(operation, elapsedMs, error)
            }
          }

          return Promise.resolve(result).then(
            (value) => {
              settled()

              return value
            },
            (error: unknown) => {
              settled(error)
              observeError(operation, error)
              throw error
            },
          )
        },
      ]
    }),
  )

  return wrapped as T
}
