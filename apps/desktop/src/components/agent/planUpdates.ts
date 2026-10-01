import { useEffect, useState } from 'react'

import { api } from '../../api'

import type { Plan, PlanLifecycleStatus } from '../../api'

const PLAN_UPDATED_EVENT = 'atlas-plan-updated'

export function emitPlanUpdated(plan: Plan) {
  window.dispatchEvent(new CustomEvent<{ plan: Plan }>(PLAN_UPDATED_EVENT, { detail: { plan } }))
}

const ACTIVE_PLAN_STATUSES: ReadonlySet<PlanLifecycleStatus> = new Set([
  'proposed',
  'approved',
  'executing',
])

const PLAN_POLL_INTERVAL_MS = 1500

type UsePlanOptions = {
  /** Keep polling even after the plan is currently terminal. Used while the
   *  owning chat stream is active, because a retry can move a failed plan back
   *  to executing. */
  keepPolling?: boolean
}

/**
 * Fetch a plan by id and keep it live. The DB is the single source of truth —
 * callers pass ONLY a planId and read everything (title, steps, per-command
 * status, lifecycle) from here. While the plan is still active (proposed /
 * approved / executing) we poll so the agent's `plan_update` writes — or a
 * teammate approving the same plan — surface without a manual refresh. Polling
 * stops once the plan reaches a terminal state, except when the owning chat
 * stream asks us to keep watching for a retry transition.
 */
export function usePlan(
  planId: string | null | undefined,
  teamId: string | undefined,
  options?: UsePlanOptions,
  // Optional snapshot the caller already has (e.g. the Plans library row).
  // Used to seed the state instantly on id change so switching plans never
  // shows the previous plan's stale content nor a loading flash — the network
  // poll just refreshes it in the background.
  initial?: Plan | null,
): { plan: Plan | null; loading: boolean } {
  const keepPolling = options?.keepPolling ?? false
  const [plan, setPlan] = useState<Plan | null>(() =>
    planId && initial?.id === planId ? initial : null,
  )
  const [pollRevision, setPollRevision] = useState(0)
  const [loading, setLoading] = useState(() => Boolean(planId) && initial?.id !== planId)

  // Every re-run of the poll effect below restarts from the caller's snapshot
  // for THIS id (or null), so a previous plan's data never carries across an id
  // switch. Doing it during render keeps that stale frame from being painted.
  const runKey = `${planId ?? ''}|${teamId ?? ''}|${keepPolling ? '1' : '0'}|${String(pollRevision)}`
  const [seededRunKey, setSeededRunKey] = useState(runKey)

  if (runKey !== seededRunKey) {
    setSeededRunKey(runKey)
    if (planId) {
      const seed = plan?.id === planId ? plan : initial?.id === planId ? initial : null

      setPlan(seed)
      setLoading(!seed)
    } else {
      setPlan(null)
    }
  }

  useEffect(() => {
    if (!planId) return
    function onPlanUpdated(event: Event) {
      const next = (event as CustomEvent<{ plan?: Plan }>).detail?.plan

      if (!next || next.id !== planId) return
      if (teamId && next.teamId !== teamId) return
      setPlan(next)
      if (ACTIVE_PLAN_STATUSES.has(next.status)) {
        setPollRevision((revision) => revision + 1)
      }
    }
    window.addEventListener(PLAN_UPDATED_EVENT, onPlanUpdated)

    return () => window.removeEventListener(PLAN_UPDATED_EVENT, onPlanUpdated)
  }, [planId, teamId])

  useEffect(() => {
    if (!planId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    // Did we ever successfully read this plan, and was it active? Drives
    // whether a failed tick retries. Without this an unfetchable plan (e.g. a
    // bad/legacy id that 404s) would poll forever.
    let lastFetchedActive = false

    const tick = async () => {
      try {
        const next = await api.agentGetPlan(planId, teamId)

        if (cancelled) return
        setPlan(next)
        lastFetchedActive = ACTIVE_PLAN_STATUSES.has(next.status)
        // Keep polling while active. Also keep polling when the owning chat is
        // streaming: a retry can move a failed terminal plan back to executing.
        if (lastFetchedActive || keepPolling) {
          timer = setTimeout(() => {
            void tick()
          }, PLAN_POLL_INTERVAL_MS)
        }
      } catch {
        // Only retry if we previously saw this plan in an active state (a real
        // transient blip mid-execution). A fetch that never succeeded — a
        // missing or invalid id — stops here instead of hammering the backend.
        if (!cancelled && (lastFetchedActive || keepPolling)) {
          timer = setTimeout(() => {
            void tick()
          }, PLAN_POLL_INTERVAL_MS)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [planId, teamId, keepPolling, pollRevision])

  return { plan, loading }
}
