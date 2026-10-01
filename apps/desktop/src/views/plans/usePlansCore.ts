import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useSilentTick } from '../../hooks/useSilentRefresh'
import { useToolbarSlot } from '../../hooks/useToolbarControls'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useResetOnKey } from '../useResetOnKey'

import { DISMISSED_STATUSES, PAGE_SIZE, isRowDismissed, proposalPlanStatus } from './planRows'

import type { LoadState, Row } from './planRows'
import type { Plan, PlanApprovalRequirement } from '../../api'
import type { PermissionGrantProposalView, TeamMember } from '../../types'

type CoreArgs = {
  teamId: string
  refreshKey: number
  filter: string
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  isTeamAdmin: boolean
}

export function usePlansCore({
  teamId,
  refreshKey,
  filter,
  onCount,
  onLoading,
  isTeamAdmin,
}: CoreArgs) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  // Team-wide permission-grant requests, surfaced alongside plans. Admins get
  // all of them (their review queue); other members get only their own.
  const [proposals, setProposals] = useState<PermissionGrantProposalView[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // A deep-linked plan can be older than the loaded page; it's fetched on its
  // own and kept here so the detail panel can show it without a matching row.
  const [fetchedPlan, setFetchedPlan] = useState<Plan | null>(null)
  const [menu, setMenu] = useState<{ row: Row; x: number; y: number } | null>(null)
  // Default list hides dismissed (rejected / cancelled) plans; toggle to show.
  const [showDismissed, setShowDismissed] = useState(false)
  const [approvalPolicy, setApprovalPolicy] = useState<PlanApprovalRequirement | null>(null)
  const [policyOpen, setPolicyOpen] = useState(false)
  const [policyMode, setPolicyMode] = useState<'requester' | 'one-other' | 'quorum'>('requester')
  const [policyQuorum, setPolicyQuorum] = useState(2)
  const [policySaving, setPolicySaving] = useState(false)

  // reload() is also the resync path after a policy change or a failed mutation,
  // so entering the loading state belongs to each caller rather than to reload.
  const reload = useCallback(() => {
    onLoading?.(true)

    return Promise.all([
      api.agentListPlans({ teamId, limit: PAGE_SIZE }),
      api
        .atlasListPermissionGrantProposals(teamId)
        .catch(() => [] as PermissionGrantProposalView[]),
    ])
      .then(([page, props]) => {
        setProposals(props)
        setState({
          kind: 'ready',
          plans: page.plans,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        })
      })
      .catch((err: unknown) => {
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      })
      .finally(() => {
        onLoading?.(false)
      })
  }, [onLoading, teamId])

  useResetOnKey(`${teamId}|${String(refreshKey)}`, () => setState({ kind: 'loading' }))
  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  useEffect(() => {
    let alive = true

    // Include removed members so a plan created by a since-removed teammate
    // still resolves to their name/avatar (flagged "Former member") instead of
    // falling back to "Unknown member".
    api
      .atlasListTeamMembers(teamId, true)
      .then((nextMembers) => {
        if (alive) setMembers(nextMembers)
      })
      .catch((err: unknown) => {
        console.warn('[plans] failed to load team members', err)
        if (alive) setMembers([])
      })

    return () => {
      alive = false
    }
  }, [teamId])

  useEffect(() => {
    let alive = true

    api.agentGetPlanApprovalPolicy(teamId).then(
      (policy) => {
        if (alive) setApprovalPolicy(policy)
      },
      (err: unknown) => {
        console.warn('[plans] failed to load approval policy', err)
        if (alive) setApprovalPolicy(null)
      },
    )

    return () => {
      alive = false
    }
  }, [teamId])

  const openPolicy = useCallback(() => {
    const minimum = approvalPolicy?.minimumOtherApprovals ?? 0

    setPolicyMode(minimum === 0 ? 'requester' : minimum === 1 ? 'one-other' : 'quorum')
    setPolicyQuorum(Math.max(2, minimum))
    setPolicyOpen(true)
  }, [approvalPolicy])

  const savePolicy = useCallback(async () => {
    const minimumOtherApprovals =
      policyMode === 'requester' ? 0 : policyMode === 'one-other' ? 1 : policyQuorum

    setPolicySaving(true)
    try {
      const policy = await api.agentUpdatePlanApprovalPolicy(teamId, minimumOtherApprovals)

      setApprovalPolicy(policy)
      setPolicyOpen(false)
      setState({ kind: 'loading' })
      void reload()
      toast.success(
        'Approval policy updated',
        'Open plans must be reviewed against the new policy.',
      )
    } catch (err) {
      toast.apiError('Could not update approval policy', err, {
        fallback: 'The approval policy was not updated. Please try again.',
      })
    } finally {
      setPolicySaving(false)
    }
  }, [policyMode, policyQuorum, reload, teamId])

  // Merge plans + permission requests into one list, newest first. Filter is an
  // exact plan number / proposal id, or a title / grant-label substring.
  const rows = useMemo<Row[]>(() => {
    if (state.kind !== 'ready') return []
    const planRows: Row[] = state.plans.map((p) => ({
      kind: 'plan',
      id: p.id,
      createdAt: p.createdAt,
      createdBy: p.createdBy,
      plan: p,
    }))
    const permRows: Row[] = proposals.map((p) => ({
      kind: 'permission',
      id: p.id,
      createdAt: p.createdAt ?? '',
      createdBy: p.createdByUserId,
      proposal: p,
    }))
    let all = [...planRows, ...permRows]
    const normalized = filter.trim().toLowerCase()

    // An active search looks across everything (incl. dismissed) so a deep
    // link / number lookup always resolves; the default list hides dismissed.
    if (normalized) {
      const numberQuery = normalized.replace(/^#/, '')

      all = all.filter((r) =>
        r.kind === 'plan'
          ? String(r.plan.number ?? '') === numberQuery ||
            r.plan.title.toLowerCase().includes(normalized)
          : r.id.toLowerCase() === normalized ||
            r.proposal.grantLabel.toLowerCase().includes(normalized),
      )
    } else if (!showDismissed) {
      all = all.filter((r) => !isRowDismissed(r))
    }

    return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  }, [state, proposals, filter, showDismissed])

  // Whether the loaded list has any dismissed rows — gates the toggle so it
  // only appears when there's something to reveal.
  const hasDismissed = useMemo(
    () =>
      (state.kind === 'ready' && state.plans.some((p) => DISMISSED_STATUSES.has(p.status))) ||
      proposals.some((p) => proposalPlanStatus(p.status) === 'rejected'),
    [state, proposals],
  )

  useEffect(() => {
    if (state.kind === 'ready') onCount?.(rows.length)
  }, [state.kind, rows.length, onCount])

  // Silent background refresh — same constraints as AgentMemoriesView: only
  // when we're showing the first page, no load-more in flight.
  const { pollTick, isActive } = useWorkspaceTab()
  const silentRefresh = useCallback(async () => {
    if (state.kind !== 'ready') return
    if (loadingMore) return
    if (state.plans.length > PAGE_SIZE) return
    try {
      const [page, props] = await Promise.all([
        api.agentListPlans({ teamId, limit: PAGE_SIZE }),
        api.atlasListPermissionGrantProposals(teamId).catch(() => proposals),
      ])

      setProposals(props)
      setState({
        kind: 'ready',
        plans: page.plans,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      })
    } catch {
      // swallow; next foreground load surfaces errors
    }
  }, [state, loadingMore, teamId, proposals])

  useSilentTick(() => {
    void silentRefresh()
  }, pollTick)

  // The approval-policy strip's actions ride the shared toolbar: the
  // dismissed-toggle sits by the search box (left), Configure in
  // the actions region (right). The policy summary itself stays a body banner.
  // Gate on isActive so a background tab never leaks these, and drop them in the
  // error state (which renders no list) so the slots don't linger.
  const dismissedToggleActive = isActive && state.kind !== 'error' && hasDismissed && !filter.trim()
  const configureActive = isActive && state.kind !== 'error' && isTeamAdmin
  const dismissedSlot = useToolbarSlot('left', dismissedToggleActive)
  const configureSlot = useToolbarSlot('right', configureActive)

  return {
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
    menu,
    setMenu,
    showDismissed,
    setShowDismissed,
    approvalPolicy,
    policyOpen,
    setPolicyOpen,
    policyMode,
    setPolicyMode,
    policyQuorum,
    setPolicyQuorum,
    policySaving,
    reload,
    openPolicy,
    savePolicy,
    rows,
    dismissedSlot,
    configureSlot,
  }
}
