import { useEffect, useMemo, useReducer } from 'react'

import { api } from '../../../api'

import { sortedIds } from './credentialAccess'
import { getAgentLocale } from './textUtils'

import type { AgentStarterSuggestion } from '../../../api'

// Session-lived cache of generated starter suggestions, keyed by team + the
// sorted resource set. Revisiting home or remounting the panel reuses the
// result instead of re-hitting the model.
export const starterSuggestionsCache = new Map<string, AgentStarterSuggestion[]>()
// Failed fetches are remembered with a timestamp (not cached as []) so a
// persistent error doesn't hammer the model on every remount, yet a fresh mount
// after the cooldown lapses is still allowed to retry.
export const starterSuggestionsFailedAt = new Map<string, number>()
export const STARTER_SUGGESTIONS_RETRY_MS = 60_000
// In-flight request per key, stored as the shared promise. Every mounted hook
// subscribes to it (not just the instance that kicked it off), so whichever
// instances survive to settle-time all re-render — fixing the case where the
// initiating mount unmounts (or a StrictMode replay) and leaves a later
// instance stuck in `loading`.
export const starterSuggestionsInFlight = new Map<string, Promise<void>>()

export function starterSuggestionsKey(teamId: string, resources: string[]): string {
  return `${teamId}|${sortedIds(resources).join(',')}`
}

// Start a fetch for `key`, or return the already-in-flight promise so
// concurrent mounts share one request. Resolves once the cache/failure map is
// updated; never rejects (failures are recorded, not thrown).
export function fetchStarterSuggestions(
  teamId: string,
  key: string,
  resources: string[],
): Promise<void> {
  const existing = starterSuggestionsInFlight.get(key)

  if (existing) return existing
  const p = api
    .agentGetStarterSuggestions({ teamId, resources, locale: getAgentLocale() })
    .then((res) => {
      starterSuggestionsCache.set(key, res.suggestions ?? [])
      starterSuggestionsFailedAt.delete(key)
    })
    .catch((err: unknown) => {
      // Best-effort: record the failure time so the home page shows nothing now
      // but can retry on a later mount once the cooldown passes.
      console.warn('[agent] failed to fetch starter suggestions', err)
      starterSuggestionsFailedAt.set(key, Date.now())
    })
    .finally(() => {
      starterSuggestionsInFlight.delete(key)
    })

  starterSuggestionsInFlight.set(key, p)

  return p
}

/**
 * Fetch LLM-generated starter questions tailored to the team's connected
 * resources, once per (team, resource-set). Enabled only on the page-mode home
 * screen with at least one integration bound; disabled state returns nothing.
 * State is derived from the module cache during render (not mirrored into
 * component state); the async fetch just populates the cache and re-renders.
 */
export function useStarterSuggestions({
  teamId,
  resources,
  enabled,
}: {
  teamId?: string
  resources?: string[]
  enabled: boolean
}): { suggestions: AgentStarterSuggestion[]; loading: boolean } {
  const list = useMemo(() => (resources ?? []).map((r) => r.trim()).filter(Boolean), [resources])
  // A stable primitive key so the effect only re-runs when the resource set
  // (not its array identity) actually changes.
  const key = teamId && list.length > 0 ? starterSuggestionsKey(teamId, list) : null
  // Bumped from the fetch's completion (never synchronously inside the effect)
  // to force a re-read of the cache.
  const [, bumpTick] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!enabled || !key || !teamId) return
    // Already have a good result — nothing to do.
    if (starterSuggestionsCache.has(key)) return
    // A recent failure still inside the cooldown — stay empty, don't refetch.
    const failedAt = starterSuggestionsFailedAt.get(key)

    if (failedAt !== undefined && Date.now() - failedAt < STARTER_SUGGESTIONS_RETRY_MS) return
    let alive = true

    // Start a fetch or subscribe to the one already in flight; either way this
    // instance re-renders when it settles so it leaves the loading state.
    void fetchStarterSuggestions(teamId, key, list).finally(() => {
      if (alive) bumpTick()
    })

    return () => {
      alive = false
    }
    // `list` is memoized above; `key` captures its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, teamId])

  const suggestions = key ? (starterSuggestionsCache.get(key) ?? []) : []
  // Loading while we have a key to fetch that has neither a cached result nor a
  // recorded failure yet. A failure clears the skeleton (shows nothing) without
  // being mistaken for a still-pending fetch.
  const settled = !key || starterSuggestionsCache.has(key) || starterSuggestionsFailedAt.has(key)
  const loading = enabled && Boolean(key) && !settled

  return { suggestions, loading }
}
