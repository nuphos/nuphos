import { useCallback, useEffect, useMemo, useRef } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'

import { PAGE_SIZE } from './planRows'

import type { LoadState, Row } from './planRows'
import type { Plan } from '../../api'
import type { PermissionGrantProposalView, TeamMember } from '../../types'

type SelectionArgs = {
  teamId: string
  filter: string
  state: LoadState
  setState: React.Dispatch<React.SetStateAction<LoadState>>
  proposals: PermissionGrantProposalView[]
  members: TeamMember[]
  loadingMore: boolean
  setLoadingMore: React.Dispatch<React.SetStateAction<boolean>>
  selectedId: string | null
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>
  fetchedPlan: Plan | null
  setFetchedPlan: React.Dispatch<React.SetStateAction<Plan | null>>
}

export function usePlansSelection({
  teamId,
  filter,
  state,
  setState,
  proposals,
  members,
  loadingMore,
  setLoadingMore,
  selectedId,
  setSelectedId,
  fetchedPlan,
  setFetchedPlan,
}: SelectionArgs) {
  const loadMore = useCallback(async () => {
    if (state.kind !== 'ready' || !state.nextCursor || loadingMore) return
    const cursor = state.nextCursor

    setLoadingMore(true)
    try {
      const page = await api.agentListPlans({ teamId, limit: PAGE_SIZE, cursor })

      setState((prev) => {
        if (prev.kind !== 'ready') return prev
        if (prev.nextCursor !== cursor) return prev

        return {
          kind: 'ready',
          plans: [...prev.plans, ...page.plans],
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        }
      })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoadingMore(false)
    }
  }, [state, loadingMore, teamId, setLoadingMore, setState])

  const selectedRow = useMemo<Row | null>(() => {
    if (!selectedId || state.kind !== 'ready') return null
    const plan =
      state.plans.find((p) => p.id === selectedId) ??
      (fetchedPlan?.id === selectedId ? fetchedPlan : null)

    if (plan)
      return {
        kind: 'plan',
        id: plan.id,
        createdAt: plan.createdAt,
        createdBy: plan.createdBy,
        plan,
      }
    const proposal = proposals.find((p) => p.id === selectedId)

    if (proposal)
      return {
        kind: 'permission',
        id: proposal.id,
        createdAt: proposal.createdAt ?? '',
        createdBy: proposal.createdByUserId,
        proposal,
      }

    return null
  }, [state, proposals, selectedId, fetchedPlan])

  // Auto-open the detail panel from a deep link. A bare plan number (#50) opens
  // that plan (fetched if off-page); a hex id opens the matching permission
  // request from the loaded team list. Guarded per value so closing the panel
  // doesn't immediately re-open it.
  const autoSelectedForRef = useRef<string | null>(null)

  useEffect(() => {
    const raw = filter.trim()

    if (!raw) {
      autoSelectedForRef.current = null

      return
    }
    if (autoSelectedForRef.current === raw) return
    if (state.kind !== 'ready') return

    let alive = true
    const numeric = /^#?(\d+)$/.exec(raw)

    if (!numeric) {
      // Non-numeric filter → a permission-grant proposal id. Selected off a
      // resolved promise, like the plan branch below, so the effect never
      // commits state synchronously.
      const proposal = proposals.find((p) => p.id === raw)

      if (proposal) {
        autoSelectedForRef.current = raw
        void Promise.resolve().then(() => {
          if (alive) setSelectedId(proposal.id)
        })
      }

      return () => {
        alive = false
      }
    }
    const planId = numeric[1]

    autoSelectedForRef.current = raw
    // A plan's public id is its number string, but match the numeric field
    // explicitly so the intent survives any future id-scheme change.
    const local = state.plans.find((p) => p.id === planId || String(p.number ?? '') === planId)

    ;(local ? Promise.resolve(local) : api.agentGetPlan(planId, teamId))
      .then((plan) => {
        if (!alive) return
        if (!local) setFetchedPlan(plan)
        setSelectedId(plan.id)
      })
      .catch((err: unknown) => {
        console.warn('[plans] failed to load deep-linked plan', err)
        toast.apiError('Failed to open plan', err)
      })

    return () => {
      alive = false
    }
  }, [filter, state, proposals, teamId, setFetchedPlan, setSelectedId])
  // Keyed by user id. If a user was removed and later re-invited, the active
  // entry wins over the removed one so they don't read as a "Former member".
  const membersById = useMemo(() => {
    const map = new Map<string, TeamMember>()

    for (const member of members) {
      const existing = map.get(member.id)

      if (!existing || (existing.removedAt && !member.removedAt)) {
        map.set(member.id, member)
      }
    }

    return map
  }, [members])

  return { loadMore, selectedRow, membersById }
}
