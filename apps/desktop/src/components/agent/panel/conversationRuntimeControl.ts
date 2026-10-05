import { useCallback, useMemo, useState } from 'react'

import { api } from '../../../api'
import { decideErrorToast, parseAtlasError } from '../../../api/errors'
import { AGENT_PROVIDER } from '../../../types/runtime'
import { toast } from '../../ui/toast'

import type { PanelViewCtx } from './ctx'
import type { RuntimeControl } from './RuntimeSelector'
import type { RuntimeInstance } from '../../../types/runtime'

/** Whether this destination can receive the conversation's working files too.
 *  The backend restores an archive only onto another hosted agent of the same
 *  type; anywhere else the conversation still moves, just without the files. */
function canCarryWorkspace(
  target: RuntimeInstance,
  provider: RuntimeInstance['provider'],
): boolean {
  return target.provider === provider && target.kind !== 'local'
}

/** The runtime chip in an open conversation's composer: names the agent the
 *  conversation runs on, and lists the others — picking one moves it there. */
export function useConversationRuntimeControl(c: PanelViewCtx): {
  runtimeControl: RuntimeControl | undefined
} {
  const [moving, setMoving] = useState(false)
  const {
    activeTab: tab,
    teamId,
    runtimeInstances,
    runtimeInstancesLoading,
    runtimeInstancesError,
    runtimeQuotas,
    onOpenAgentSettings,
  } = c
  const sessionId = tab?.sessionId
  const tabId = tab?.id
  const provider = tab?.agentRuntime ?? 'claude-code'

  const move = useCallback(
    async (runtimeId: string) => {
      const target = runtimeInstances.find((instance) => instance.id === runtimeId)

      if (moving) return
      if (!sessionId || !tabId || !teamId || !target) {
        console.warn('[agent] conversation move skipped', {
          sessionId,
          tabId,
          teamId,
          runtimeId,
          found: Boolean(target),
        })
        toast.error('Could not move this conversation', 'This conversation is not ready to move.')

        return
      }
      setMoving(true)
      try {
        // Try to bring the working files when the destination can hold them, and
        // fall back to history rather than making the user choose up front.
        const result = await api
          .agentMoveConversationRuntime(
            sessionId,
            teamId,
            runtimeId,
            canCarryWorkspace(target, provider) ? 'workspace' : 'history',
          )
          .catch(async (cause: unknown) => {
            // The backend's code crosses IPC inside the error message, not as a
            // property — `cause.code` is always undefined here.
            if (parseAtlasError(cause).code !== 'workspace_unavailable') throw cause
            const moved = await api.agentMoveConversationRuntime(
              sessionId,
              teamId,
              runtimeId,
              'history',
            )

            toast.success('Conversation moved', 'The working files could not come along.')

            return moved
          })

        c.setTabs((previous) =>
          previous.map((entry) =>
            entry.id === tabId
              ? {
                  ...entry,
                  runtimeId: result.runtimeId,
                  runtimeLabel: result.runtimeLabel,
                  agentRuntime: result.agentRuntime,
                }
              : entry,
          ),
        )
        window.dispatchEvent(new Event('nuphos:conversation-runtime-moved'))
        void c.refreshHistory()
        toast.success('Conversation moved', `Continue on ${result.runtimeLabel}.`)
      } catch (cause) {
        console.warn('[agent] conversation move failed', cause)
        if (decideErrorToast(cause).action === 'show') {
          toast.apiError('Could not move this conversation', cause)
        } else {
          toast.error(
            'Could not move this conversation',
            'The agent did not accept the move. Check your connection and try again.',
          )
        }
      } finally {
        setMoving(false)
      }
    },
    [c, moving, provider, runtimeInstances, sessionId, tabId, teamId],
  )

  const runtimeControl = useMemo<RuntimeControl | undefined>(() => {
    if (!sessionId || !teamId || tab?.readOnly || tab?.foreign) return
    const current = runtimeInstances.find((instance) => instance.id === tab?.runtimeId)

    return {
      value: {
        id: tab?.runtimeId,
        provider,
        label: current?.label ?? tab?.runtimeLabel ?? AGENT_PROVIDER[provider].label,
        status: current?.status,
      },
      options: runtimeInstances,
      onSelect: (runtimeId: string) => void move(runtimeId),
      selectDisabled: tab?.streaming || moving,
      quota: tab?.runtimeId ? runtimeQuotas.get(tab.runtimeId) : undefined,
      unavailable:
        !runtimeInstancesLoading && !runtimeInstancesError && current?.status !== 'active',
      loading: runtimeInstancesLoading,
      error: runtimeInstancesError,
      onSettings: onOpenAgentSettings,
    }
  }, [
    move,
    moving,
    provider,
    sessionId,
    tab,
    teamId,
    runtimeInstances,
    runtimeInstancesLoading,
    runtimeInstancesError,
    runtimeQuotas,
    onOpenAgentSettings,
  ])

  return { runtimeControl }
}
