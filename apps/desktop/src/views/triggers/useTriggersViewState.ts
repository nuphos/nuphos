import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useToolbarPrimaryAction } from '../../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useResetOnKey } from '../useResetOnKey'

import { canDeleteTeamTriggers, canManageTeamTriggers, reportCleanupFailures } from './shared'

import type { ListState } from './TriggersList'
import type { TeamMember } from '../../types'

export function useTriggersViewState({
  teamId,
  currentUserId,
  refreshKey,
  onLoading,
  inSubView,
  onCreate,
}: {
  teamId?: string
  currentUserId?: string
  refreshKey?: number
  onLoading?: (loading: boolean) => void
  /** The page is showing a trigger's runs or a form, not the list. */
  inSubView?: boolean
  onCreate: () => void
}) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [membersLoaded, setMembersLoaded] = useState(!teamId)
  // Roles decide which controls render, so a failed member load must not be
  // mistaken for "you lack permission" — it says so and offers a retry.
  const [membersFailed, setMembersFailed] = useState(false)
  const [membersReloadKey, setMembersReloadKey] = useState(0)
  const { isActive } = useWorkspaceTab()
  // Roles come from active membership only — a removed member is in this list
  // for name lookup, not to be granted anything.
  const currentRole = useMemo(
    () => members.find((member) => member.id === currentUserId && !member.removedAt)?.role,
    [members, currentUserId],
  )
  const canManage = !teamId || (membersLoaded && canManageTeamTriggers(currentRole))
  const canDelete = !teamId || (membersLoaded && canDeleteTeamTriggers(currentRole))

  useResetOnKey(`${teamId ?? ''}|${String(membersReloadKey)}`, () => {
    if (!teamId) {
      setMembers([])
      setMembersFailed(false)
      setMembersLoaded(true)

      return
    }
    setMembersLoaded(false)
    setMembersFailed(false)
  })
  useEffect(() => {
    if (!teamId) return
    let alive = true

    void api
      // Removed members are included on purpose: a Trigger whose principal
      // left the team is exactly the one whose "Runs as …" banner matters, and
      // without them it would name a raw user id.
      .atlasListTeamMembers(teamId, true)
      .then((nextMembers) => {
        if (!alive) return
        setMembers(nextMembers)
        setMembersLoaded(true)
      })
      .catch(() => {
        if (!alive) return
        setMembers([])
        setMembersFailed(true)
        setMembersLoaded(true)
      })

    return () => {
      alive = false
    }
  }, [teamId, membersReloadKey])

  // Publish "New trigger" to the shared toolbar CTA rather than the header band
  // this list carried as a modal — workspace pages get one header, and the
  // breadcrumb already names the page. Nothing while a form is open, and
  // nothing from a keep-alive'd background tab.
  useToolbarPrimaryAction(isActive && !inSubView && canManage ? 'New trigger' : null, onCreate)
  // Backend base URL, so a webhook trigger can show a copyable /webhooks/:id
  // URL with the right host (production vs local dev). Degrades gracefully:
  // the webhook URL panel stays hidden if this never arrives.
  const [atlasApiUrl, setAtlasApiUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    api
      .atlasGetApiUrl()
      .then((url) => {
        if (!cancelled) setAtlasApiUrl(url)
      })
      .catch((err: unknown) => {
        console.warn('[triggers] atlasGetApiUrl failed:', err)
      })

    return () => {
      cancelled = true
    }
  }, [])
  const [listState, setListState] = useState<ListState>({ kind: 'loading' })

  useEffect(() => {
    onLoading?.(listState.kind === 'loading')
  }, [listState.kind, onLoading])
  // Cron scheduler status. We render a banner in the cron form when this is
  // false so users know their trigger will be saved but won't auto-fire — the
  // scheduler depends on Redis (BullMQ).
  const [cronEnabled, setCronEnabled] = useState<boolean | null>(null)
  const fetchList = useCallback(
    () =>
      Promise.all([api.agentListTriggers(teamId), api.agentListTriggerGroups(teamId)])
        .then(([triggers, groups]) => {
          reportCleanupFailures(triggers)
          setListState({ kind: 'ready', triggers, groups })
        })
        .catch((err: unknown) => {
          setListState({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          })
        }),
    [teamId],
  )
  // Action-driven reloads put the list back into its loading state first; the
  // mount / team / refresh path does that from the render below instead.
  const reload = useCallback(async () => {
    setListState({ kind: 'loading' })
    await fetchList()
  }, [fetchList])

  // Reload on mount, when the team changes, and when the toolbar's refresh
  // button is pressed.
  useResetOnKey(`${teamId ?? ''}|${String(refreshKey)}`, () => {
    setListState({ kind: 'loading' })
  })
  useEffect(() => {
    void fetchList()
    void api
      .agentGetTriggerSchedulerStatus()
      .then((s) => setCronEnabled(s.cronEnabled))
      .catch(() => setCronEnabled(null))
  }, [fetchList, refreshKey])

  // Provider cleanup runs in the backend queue. Poll only while a row is in
  // the transient Removing state; success removes it, failure exposes Retry.
  const hasDeletingTrigger =
    listState.kind === 'ready' &&
    listState.triggers.some((trigger) => trigger.cleanupStatus === 'deleting')

  useEffect(() => {
    // Mounted-and-on-the-list is the whole condition now that this is a page:
    // navigating away unmounts it, which stops the poll.
    if (inSubView || !hasDeletingTrigger) return
    let cancelled = false
    let timer: number | undefined
    let failures = 0
    const poll = async () => {
      let shouldContinue = true

      try {
        const [triggers, groups] = await Promise.all([
          api.agentListTriggers(teamId),
          api.agentListTriggerGroups(teamId),
        ])

        if (cancelled) return
        failures = 0
        shouldContinue = triggers.some((trigger) => trigger.cleanupStatus === 'deleting')
        reportCleanupFailures(triggers)
        setListState({ kind: 'ready', triggers, groups })
      } catch (err) {
        if (cancelled) return
        failures += 1
        toast.apiError('Could not refresh Watch cleanup', err)
      } finally {
        if (!cancelled && shouldContinue) {
          const delay = Math.min(2_000 * 2 ** failures, 30_000)

          timer = window.setTimeout(() => {
            void poll()
          }, delay)
        }
      }
    }

    timer = window.setTimeout(() => {
      void poll()
    }, 2_000)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [inSubView, hasDeletingTrigger, teamId])

  return {
    members,
    membersFailed,
    setMembersReloadKey,
    canManage,
    canDelete,
    atlasApiUrl,
    listState,
    setListState,
    cronEnabled,
    isActive,
    reload,
  }
}
