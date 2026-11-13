import { useCallback, useMemo, useRef, useState } from 'react'

import { api } from '../../../api'
import { decideErrorToast } from '../../../api/errors'
import { t } from '../../../i18n/index.ts'
import { localAgentMoveWarning, moveNotice } from '../../../lib/localAgentSharing'
import { AGENT_PROVIDER } from '../../../types/runtime'
import { toast } from '../../ui/toast'

import type { PanelViewCtx } from './ctx'
import type { RuntimeControl } from './RuntimeSelector'
import type { RuntimeInstance } from '../../../types/runtime'

/** The runtime chip in an open conversation's composer: names the agent the
 *  conversation runs on, and lists the others — picking one moves it there. */
export function useConversationRuntimeControl(c: PanelViewCtx): {
  runtimeControl: RuntimeControl | undefined
} {
  return {
    runtimeControl: useSessionRuntimeControl({
      ...c,
      update: (patch) =>
        c.setTabs((previous) =>
          previous.map((entry) => (entry.id === c.activeTab?.id ? { ...entry, ...patch } : entry)),
        ),
    }),
  }
}

type RuntimeTab = Pick<
  NonNullable<PanelViewCtx['activeTab']>,
  | 'id'
  | 'sessionId'
  | 'agentRuntime'
  | 'runtimeId'
  | 'runtimeLabel'
  | 'movingTo'
  | 'readOnly'
  | 'foreign'
  | 'canManage'
  | 'streaming'
  | 'timelineEvents'
>
type SessionRuntimeContext = Pick<
  PanelViewCtx,
  | 'teamId'
  | 'isTeamAdmin'
  | 'runtimeInstances'
  | 'runtimeInstancesLoading'
  | 'runtimeInstancesError'
  | 'runtimeQuotas'
  | 'onOpenAgentSettings'
  | 'currentUser'
  | 'refreshHistory'
> & {
  activeTab: RuntimeTab | null
  update: (patch: Partial<RuntimeTab>) => void
}

/** Shared move flow for a Task and its Bot chat, including host-trust confirmation. */
export function useSessionRuntimeControl(c: SessionRuntimeContext): RuntimeControl | undefined {
  const {
    activeTab: tab,
    teamId,
    isTeamAdmin,
    runtimeInstances,
    runtimeInstancesLoading,
    runtimeInstancesError,
    runtimeQuotas,
    onOpenAgentSettings,
    refreshHistory,
    update: setTab,
  } = c
  const sessionId = tab?.sessionId
  const tabId = tab?.id
  const provider = tab?.agentRuntime ?? 'claude-code'
  const moving = Boolean(tab?.movingTo)
  const moveInFlight = useRef(false)

  const move = useCallback(
    async (runtimeId: string, grantComputerUse?: boolean) => {
      const target = runtimeInstances.find((instance) => instance.id === runtimeId)

      if (moving || moveInFlight.current) return
      if (!sessionId || !tabId || !teamId || !target) {
        console.warn('[agent] conversation move skipped', {
          sessionId,
          tabId,
          teamId,
          runtimeId,
          found: Boolean(target),
        })
        toast.error(t('Could not move this agent'), t('This agent is not ready to move.'))

        return
      }
      // The timeline shows a pending line from here until the move's own event
      // replaces it, so the result needs no toast of its own.
      moveInFlight.current = true
      setTab({ movingTo: target.label })
      try {
        const result = await api.agentMoveConversationRuntime(
          sessionId,
          teamId,
          runtimeId,
          grantComputerUse,
        )

        // Read the event back now rather than on the next catch-up poll.
        const detail = await api
          .agentGetConversation(sessionId, teamId, { tail: 1 })
          .catch(() => null)

        setTab({
          runtimeId: result.runtimeId,
          runtimeLabel: result.runtimeLabel,
          agentRuntime: result.agentRuntime,
          ...(detail ? { timelineEvents: detail.timelineEvents } : {}),
          movingTo: undefined,
        })
        window.dispatchEvent(new Event('nuphos:conversation-runtime-moved'))
        void refreshHistory()
      } catch (cause) {
        setTab({ movingTo: undefined })
        console.warn('[agent] conversation move failed', cause)
        if (decideErrorToast(cause).action === 'show') {
          toast.apiError(t('Could not move this agent'), cause)
        } else {
          toast.error(
            t('Could not move this agent'),
            t('The runtime did not accept the move. Check your connection and try again.'),
          )
        }
      } finally {
        moveInFlight.current = false
      }
    },
    [moving, refreshHistory, runtimeInstances, sessionId, setTab, tabId, teamId],
  )

  // Explain host trust, and who would lose reply, before a move.
  const [pendingMove, setPendingMove] = useState<{
    target: RuntimeInstance
    notice: string
    docs: boolean
    grant: boolean
  } | null>(null)

  const runtimeControl = useMemo<RuntimeControl | undefined>(() => {
    if (!sessionId || !teamId || tab?.readOnly) return
    // A teammate's conversation you cannot manage: its agent's state and fixes, nothing to pick.
    const canMove = !tab?.foreign || tab.canManage
    const current = runtimeInstances.find((instance) => instance.id === tab?.runtimeId)

    return {
      teamId,
      sessionId,
      canUpdateTeamAgents: isTeamAdmin,
      value: {
        id: tab?.runtimeId,
        provider,
        label: current?.label ?? tab?.runtimeLabel ?? AGENT_PROVIDER[provider].label,
        status: current?.status,
      },
      // Only the owner puts a session on a local or self-hosted agent.
      options:
        tab?.foreign && canMove
          ? runtimeInstances.filter((instance) => instance.kind === 'managed')
          : runtimeInstances,
      ...(canMove && {
        onSelect: (runtimeId: string, access) => {
          const target = runtimeInstances.find((instance) => instance.id === runtimeId)

          if (!target) return void move(runtimeId)
          const hostTrust = localAgentMoveWarning(target, access, c.currentUser?.id)

          void api
            .agentCheckConversationMove(sessionId, teamId, runtimeId)
            // A backend without the check: nobody to list, as before.
            .catch(() => null)
            .then((check) => {
              const notice = moveNotice(target, hostTrust, check)

              if (!notice) return void move(runtimeId)
              setPendingMove({
                target,
                notice,
                docs: hostTrust !== undefined,
                grant: Boolean(check?.canGrant && check.losing.length > 0),
              })
            })
        },
      }),
      selectDisabled: tab?.streaming || moving,
      quotas: runtimeQuotas,
      unavailable:
        !runtimeInstancesLoading && !runtimeInstancesError && current?.status !== 'active',
      loading: runtimeInstancesLoading,
      error: runtimeInstancesError,
      onSettings: onOpenAgentSettings,
      ...(pendingMove
        ? {
            confirm: {
              title: t('Move to {name}?', { name: pendingMove.target.label }),
              description: pendingMove.notice,
              sharedComputerDocs: pendingMove.docs,
              confirmLabel: t('Move'),
              onConfirm: () => {
                setPendingMove(null)
                void move(pendingMove.target.id, pendingMove.grant)
              },
              onCancel: () => setPendingMove(null),
            },
          }
        : {}),
    }
  }, [
    pendingMove,
    c.currentUser?.id,
    move,
    moving,
    provider,
    sessionId,
    tab,
    teamId,
    isTeamAdmin,
    runtimeInstances,
    runtimeInstancesLoading,
    runtimeInstancesError,
    runtimeQuotas,
    onOpenAgentSettings,
  ])

  return runtimeControl
}
