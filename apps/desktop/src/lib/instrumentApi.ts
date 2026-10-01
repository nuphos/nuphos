type ErrorObserver = (operation: string, error: unknown) => void
type InstrumentApiOptions = {
  stallAfterMs?: number
  observeStall?: (operation: string, elapsedMs: number) => void
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
          let stallTimer: ReturnType<typeof setTimeout> | undefined
          const stallAfterMs = options.stallAfterMs
          const observeStall = options.observeStall

          if (stallAfterMs !== undefined && observeStall) {
            stallTimer = setTimeout(() => observeStall(operation, stallAfterMs), stallAfterMs)
          }

          return Promise.resolve(result)
            .catch((error: unknown) => {
              observeError(operation, error)
              throw error
            })
            .finally(() => {
              if (stallTimer !== undefined) clearTimeout(stallTimer)
            })
        },
      ]
    }),
  )

  return wrapped as T
}
