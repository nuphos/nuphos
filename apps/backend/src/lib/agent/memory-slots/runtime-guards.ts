// Runtime-owned fail-open observer factory. Split from runtime.ts; providers
// never import this module either.

import { logError } from '@/lib/observability'

import type { MemoryObserver } from './types'

/** Wraps raw sinks fail-open: a throwing sink logs
 * memory.observer.<name>_failed and never fails the provider call that fired
 * it (SPI contract: providers receive observers ALREADY wrapped). */
export function createMemoryObserver(input: {
  providerId: string
  sinks: Partial<MemoryObserver>
}): MemoryObserver {
  const wrap = <TEvent>(
    name: 'saved' | 'fetched' | 'searched',
    sink: ((event: TEvent) => void) | undefined,
  ): ((event: TEvent) => void) => {
    return (event: TEvent) => {
      try {
        // Sinks are typed void, but a sink that accidentally returns a
        // rejecting promise must not surface as an unhandled rejection —
        // that is exactly the failure mode this wrapper exists to prevent.
        const result = sink?.(event) as unknown

        if (result && typeof (result as PromiseLike<void>).then === 'function') {
          void Promise.resolve(result as PromiseLike<void>).catch((err: unknown) => {
            logError(`memory.observer.${name}_failed`, err, { provider: input.providerId })
          })
        }
      } catch (err) {
        logError(`memory.observer.${name}_failed`, err, { provider: input.providerId })
      }
    }
  }

  return {
    saved: wrap('saved', input.sinks.saved),
    fetched: wrap('fetched', input.sinks.fetched),
    searched: wrap('searched', input.sinks.searched),
  }
}
