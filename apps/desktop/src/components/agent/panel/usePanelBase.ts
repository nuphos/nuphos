import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { publishRuntimeStates, useAgentRuntimeStates } from '../../../lib/agentRuntimeStates'
import { newestRuntimeSnapshot } from '../../../lib/runtimeExecution'

import { AGENT_WIDTH_KEY, DEFAULT_WIDTH_VW, MAX_WIDTH_VW, MIN_WIDTH_VW } from './constants'
import { HOME_TAB_ID } from './model'
import { panelVisible } from './panelVisibility'
import { useNewConversationRuntime } from './useNewConversationRuntime'
import { useStarterSuggestions } from './useStarterSuggestions'

import type { PanelCtx } from './ctx'
import type { Tab } from './model'

type Acc = Pick<
  PanelCtx,
  | 'connectedResources'
  | 'kubeContext'
  | 'open'
  | 'paid'
  | 'runtimeKubeContextRef'
  | 'runtimeUrlRef'
  | 'teamId'
  | 'unbound'
  | 'url'
  | 'variant'
>

export function usePanelBase(acc: Acc) {
  const {
    connectedResources,
    kubeContext,
    open,
    paid,
    runtimeKubeContextRef,
    runtimeUrlRef,
    teamId,
    unbound,
    url,
    variant,
  } = acc

  const conversationRuntime = useNewConversationRuntime(teamId)
  const visible = panelVisible(variant, open)
  // No integrations bound yet. The page used to refuse to talk at all in this
  // state; now it only withholds what genuinely needs resources behind it.
  const gated = unbound
  const isSidebarMode = variant === 'panel'
  // Starter questions tailored to the connected resources, shown on the page
  // home once at least one integration is bound (i.e. not gated). Only fetched
  // in page mode — the sidebar Welcome keeps its static presets.
  const homeStarterSuggestions = useStarterSuggestions({
    teamId,
    resources: connectedResources,
    enabled: variant === 'page' && !gated && paid,
  })
  // Read the latest URL inside callbacks without re-creating them on every nav.
  const localUrlRef = useRef<string | undefined>(url)

  useEffect(() => {
    localUrlRef.current = url
  }, [url])
  const urlRef = runtimeUrlRef ?? localUrlRef
  // Same pattern for the workspace tab's kubeconfig context — `agentStart`
  // calls live inside long-lived callbacks (resume handler, retry handler,
  // etc.) and a ref keeps them current without re-creating closures.
  const localKubeContextRef = useRef<string | null | undefined>(kubeContext)

  useEffect(() => {
    localKubeContextRef.current = kubeContext
  }, [kubeContext])
  const kubeContextRef = runtimeKubeContextRef ?? localKubeContextRef
  // Same pattern for teamId so the long-lived agent event listener can fire
  // auto-resume requests with the active team without tearing down + re-
  // registering the IPC subscription on every team switch.
  const teamIdRef = useRef<string | undefined>(teamId)

  useEffect(() => {
    teamIdRef.current = teamId
  }, [teamId])

  const [widthVw, setWidthVw] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_WIDTH_VW
    const v = Number(localStorage.getItem(AGENT_WIDTH_KEY))

    if (!v || Number.isNaN(v)) return DEFAULT_WIDTH_VW

    return Math.min(MAX_WIDTH_VW, Math.max(MIN_WIDTH_VW, v))
  })
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return
    function move(e: MouseEvent) {
      const next = ((window.innerWidth - e.clientX) / window.innerWidth) * 100

      setWidthVw(Math.min(MAX_WIDTH_VW, Math.max(MIN_WIDTH_VW, next)))
    }
    function up() {
      setDragging(false)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)

    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
  }, [dragging])

  useEffect(() => {
    localStorage.setItem(AGENT_WIDTH_KEY, String(widthVw))
  }, [widthVw])

  const [localTabs, setTabs] = useState<Tab[]>([])
  const runtimeStates = useAgentRuntimeStates()
  const tabs = useMemo(
    () =>
      localTabs.map((tab) => {
        const runtimeState = newestRuntimeSnapshot(
          tab.runtimeState,
          runtimeStates.get(tab.sessionId),
        )

        return runtimeState === tab.runtimeState ? tab : { ...tab, runtimeState }
      }),
    [localTabs, runtimeStates],
  )
  const [activeId, setActiveId] = useState<string>(HOME_TAB_ID)
  const tabsRef = useRef(tabs)

  useLayoutEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    publishRuntimeStates(
      localTabs.flatMap((tab) =>
        tab.sessionId && tab.runtimeState ? [[tab.sessionId, tab.runtimeState] as const] : [],
      ),
    )
  }, [localTabs])

  return {
    ...conversationRuntime,
    visible,
    gated,
    isSidebarMode,
    homeStarterSuggestions,
    urlRef,
    kubeContextRef,
    teamIdRef,
    widthVw,
    setWidthVw,
    dragging,
    setDragging,
    tabs,
    setTabs,
    activeId,
    setActiveId,
    tabsRef,
  }
}
