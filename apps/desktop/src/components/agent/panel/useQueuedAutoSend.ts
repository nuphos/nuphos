import { useEffect } from 'react'

import { api } from '../../../api'
import { acceptRuntimeSnapshot, runtimeStatusLabel } from '../../../lib/runtimeExecution'
import { toast } from '../../ui/toast'

import { nextAutoSend, pumpAutoSend, stopAutoSend, withoutQueued } from './queuedAutoSend'

import type { PanelCtx } from './ctx'
import type { QueuedMessage, Tab } from './model'
import type { RuntimeExecution } from '../../../lib/runtimeExecution'

const FAST_POLL_MS = 1_000
const FAST_POLL_WINDOW_MS = 30_000
const SLOW_POLL_MS = 4_000

type Acc = Pick<PanelCtx, 'setTabs' | 'tabs' | 'tabsRef' | 'teamId' | 'uploadingTabsRef'> & {
  dispatchTurn: (
    tabId: string,
    text: string,
    filePaths: string[],
    turnKind?: QueuedMessage['turnKind'],
  ) => Promise<void>
}

async function probeRuntime(sessionId: string, teamId: string | undefined) {
  const requestedAt = performance.now()
  const detail = await api.agentGetConversation(sessionId, teamId, { tail: 1 })

  return {
    ...(detail.runtimeState ?? { state: 'unsupported' as const }),
    observedAt: requestedAt,
  }
}

function withRuntimeState(tabId: string, snapshot: RuntimeExecution) {
  return (tabs: Tab[]) =>
    tabs.map((t) =>
      t.id === tabId ? { ...t, runtimeState: acceptRuntimeSnapshot(t.runtimeState, snapshot) } : t,
    )
}

function withoutAutoSend(tabId: string) {
  return (tabs: Tab[]) => tabs.map((t) => (t.id === tabId ? stopAutoSend(t) : t))
}

function dequeue(tabId: string, queuedId: string) {
  return (tabs: Tab[]) => tabs.map((t) => (t.id === tabId ? withoutQueued(t, queuedId) : t))
}

/** Send each tab's waiting message the moment its agent reports `send` is allowed. */
export function useQueuedAutoSend({
  dispatchTurn,
  setTabs,
  tabs,
  tabsRef,
  teamId,
  uploadingTabsRef,
}: Acc) {
  const waitingTabs = tabs
    .filter((tab) => nextAutoSend(tab))
    .map((tab) => tab.id)
    .join(',')

  useEffect(() => {
    if (!waitingTabs) return
    const startedAt = performance.now()
    let stopped = false
    let timer: number | undefined
    const deps = {
      probe: (sessionId: string) => probeRuntime(sessionId, teamId),
      onRuntimeState: (tabId: string, snapshot: RuntimeExecution) =>
        setTabs(withRuntimeState(tabId, snapshot)),
      dispatch: async (tabId: string, item: QueuedMessage) => {
        if (stopped) return
        setTabs(dequeue(tabId, item.id))
        await dispatchTurn(tabId, item.text, item.filePaths, item.turnKind)
      },
      onNeverSendable: (tabId: string, snapshot: RuntimeExecution) => {
        setTabs(withoutAutoSend(tabId))
        toast.error(runtimeStatusLabel(snapshot), 'Your message was kept as an unsent draft.')
      },
    }
    const tick = async () => {
      for (const tab of tabsRef.current) {
        if (stopped) return
        if (uploadingTabsRef.current.has(tab.id)) continue
        await pumpAutoSend(tab, deps).catch(() => 'waiting')
      }
    }
    const schedule = () => {
      if (stopped) return
      const delay =
        performance.now() - startedAt < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS

      timer = window.setTimeout(() => void tick().finally(schedule), delay)
    }

    void tick().finally(schedule)

    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [waitingTabs, dispatchTurn, setTabs, tabsRef, teamId, uploadingTabsRef])
}
