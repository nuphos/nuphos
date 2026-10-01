// Runtime-owned fail-open guards: the observer factory and the recall budget
// race. Split from runtime.ts; providers never import this module either.

import { logError } from '@/lib/observability'

import type { MemoryObserver, MemoryProvider, RecallInput, RenderedMemoryContext } from './types'

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

// ── Recall budget race ───────────────────────────────────────────────────────
// Budgets are code constants, not env keys (spec §e: added only if ops need
// them). Per-provider budgetMs (A5④) is clamped to the ceiling.

const RECALL_BUDGET_DEFAULT_MS = 5_000
const RECALL_BUDGET_CEILING_MS = 15_000

/** Races recall.render against the provider's budget. Timeout, throw, and
 * absent slot all resolve null — recall failure is "no context", NEVER a turn
 * error. A hung provider is abandoned (its late settlement is swallowed). */
export async function raceRecallBudget(
  provider: MemoryProvider,
  input: RecallInput,
): Promise<RenderedMemoryContext | null> {
  const recall = provider.recall

  if (!recall) return null
  // Clamp BOTH ends: budgetMs is vendor-supplied metadata — 0, negative, or
  // NaN would fire the timeout immediately and silently kill every recall.
  const declared = recall.budgetMs
  const budgetMs = Math.min(
    typeof declared === 'number' && Number.isFinite(declared) && declared > 0
      ? declared
      : RECALL_BUDGET_DEFAULT_MS,
    RECALL_BUDGET_CEILING_MS,
  )
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, budgetMs)

  try {
    const rendered = recall.render(input, { signal: controller.signal })
    // Attach the swallow handler NOW: an abandoned render that rejects after
    // the deadline must not surface as an unhandled rejection.
    const guarded = rendered.catch((err: unknown) => {
      // An abandoned render rejecting with AbortError is the EXPECTED tail of
      // a tripped budget — budget_exceeded already logged it; logging
      // render_failed too would double-count every timeout in alerting.
      if (!(err instanceof Error && err.name === 'AbortError')) {
        logError('memory.recall.render_failed', err, { provider: provider.meta.id })
      }

      return null
    })
    const deadline = new Promise<null>((resolve) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          // A tripped budget must leave a trace: to the user it is silent
          // (no recall context this turn), but ops needs to see a provider
          // that is habitually slow — that is a switch/tuning signal.
          logError(
            'memory.recall.budget_exceeded',
            new Error(`recall budget ${String(budgetMs)}ms exceeded`),
            { provider: provider.meta.id },
          )
          resolve(null)
        },
        { once: true },
      )
    })

    return await Promise.race([guarded, deadline])
  } catch (err) {
    // Synchronous throw from a misbehaving render().
    logError('memory.recall.render_failed', err, { provider: provider.meta.id })

    return null
  } finally {
    clearTimeout(timer)
  }
}
