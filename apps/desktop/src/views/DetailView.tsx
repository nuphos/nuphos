import clsx from 'clsx'
import { Network, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { useRequiredKubeContext } from '../hooks/useKubeContext'

import { EventsTab } from './detail/events-tab'
import { OverviewTabContent } from './detail/overview-router'
import { PodLogs } from './detail/pod-logs'
import { detailTargetKey } from './detail/target'
import { NodeTerminalTab, PodTerminalTab } from './detail/terminal-tabs'
import { WorkloadLogsTab } from './detail/workload-logs-tab'
import { YamlTab } from './detail/yaml-tab'
import { PortForwardDialog } from './PortForwardDialog'
import { useResetOnKey } from './useResetOnKey'

import type { PodPort } from '../types'
import type { DetailTarget } from './detail/target'

export type { DetailTarget } from './detail/target'

type Props = {
  target: DetailTarget
  refreshKey: number
  onClose: () => void
  // Optional drill-down handler. The workload detail's Pods tab calls this
  // to switch the current detail target to a clicked pod. When omitted,
  // nested pod selection is a no-op.
  onNavigate?: (target: DetailTarget) => void
}

export function DetailView({ target, refreshKey, onClose, onNavigate }: Props) {
  const context = useRequiredKubeContext()
  const hasMatchedPods =
    target.kind === 'Deployment' ||
    target.kind === 'StatefulSet' ||
    target.kind === 'DaemonSet' ||
    target.kind === 'ReplicaSet' ||
    target.kind === 'Job'
  const tabs: string[] = (() => {
    if (target.kind === 'Pod') return ['Overview', 'Logs', 'Terminal', 'YAML', 'Events']
    if (target.kind === 'Node') return ['Overview', 'Terminal', 'YAML', 'Events']
    if (target.kind === 'Deployment' || hasMatchedPods)
      return ['Overview', 'Logs', 'YAML', 'Events']

    return ['Overview', 'YAML', 'Events']
  })()
  const [tab, setTab] = useState<string>(
    target.initialTab && tabs.includes(target.initialTab) ? target.initialTab : tabs[0],
  )
  // Port-forward target carries the kubeconfig context that was active when
  // the user clicked the button. We don't read context from React state at
  // submit time so that switching the tab's cluster while the dialog is open
  // doesn't reroute the forward to a different cluster.
  const [portForwardTarget, setPortForwardTarget] = useState<{
    kind: 'Pod' | 'Service'
    namespace: string
    name: string
    ports: PodPort[]
    context: string
  } | null>(null)
  const [portForwardLoading, setPortForwardLoading] = useState(false)
  // The Terminal tab stays mounted (just hidden) once first opened so the exec
  // session and scrollback survive tab switches; it's torn down only when the
  // detail target changes or the view closes.
  const [terminalMounted, setTerminalMounted] = useState(target.initialTab === 'Terminal')
  const targetRef = useRef(target)

  useEffect(() => {
    targetRef.current = target
  })
  // Reset on a genuine target identity change. initialTab is deliberately NOT
  // part of the key here: it's a one-shot navigation hint, not part of identity
  // — re-selecting the same pod via the plain path (no initialTab) must not
  // tear down a running Terminal session.
  useResetOnKey(detailTargetKey(target), () => {
    setTab(target.initialTab && tabs.includes(target.initialTab) ? target.initialTab : tabs[0])
    setPortForwardLoading(false)
    setPortForwardTarget(null)
    setTerminalMounted(target.initialTab === 'Terminal')
  })

  // Honor a deep-link tab hint (e.g. "Exec shell" → Terminal) even when the
  // pod detail is already open on it. Only advances the tab; never resets.
  useResetOnKey(target.initialTab ?? '', () => {
    if (target.initialTab && tabs.includes(target.initialTab)) setTab(target.initialTab)
  })

  useResetOnKey(tab, () => {
    if (tab === 'Terminal') setTerminalMounted(true)
  })

  async function handleOpenPortForward() {
    if (!target.namespace || (target.kind !== 'Pod' && target.kind !== 'Service')) return
    const requestTarget: { kind: 'Pod' | 'Service'; namespace: string; name: string } = {
      kind: target.kind,
      namespace: target.namespace,
      name: target.name,
    }
    // Snapshot the cluster the user saw when clicking. Even if the tab's
    // kubeconfigContext changes mid-fetch, the dialog will be opened against
    // this captured value.
    const actionContext = context
    const isCurrentTarget = () =>
      targetRef.current.kind === requestTarget.kind &&
      targetRef.current.namespace === requestTarget.namespace &&
      targetRef.current.name === requestTarget.name

    setPortForwardLoading(true)
    try {
      const ports =
        requestTarget.kind === 'Pod'
          ? await api.k8sGetPodPortForwardOptions(
              actionContext,
              requestTarget.namespace,
              requestTarget.name,
            )
          : await api.k8sGetServicePortForwardOptions(
              actionContext,
              requestTarget.namespace,
              requestTarget.name,
            )

      if (!isCurrentTarget()) return
      setPortForwardTarget({
        kind: requestTarget.kind,
        namespace: requestTarget.namespace,
        name: requestTarget.name,
        ports,
        context: actionContext,
      })
    } catch (e) {
      console.error('[port-forward] failed to load port options:', e)
      if (!isCurrentTarget()) return
      setPortForwardTarget({
        kind: requestTarget.kind,
        namespace: requestTarget.namespace,
        name: requestTarget.name,
        ports: [],
        context: actionContext,
      })
    } finally {
      if (isCurrentTarget()) setPortForwardLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {portForwardTarget && (
        <PortForwardDialog
          open
          context={portForwardTarget.context}
          target={portForwardTarget}
          onClose={() => setPortForwardTarget(null)}
        />
      )}
      <div className="px-6 pt-4">
        <div className="flex items-center gap-2 text-[12px] text-tertiary mb-1">
          {target.namespace && (
            <>
              <span>{target.namespace}</span>
              <span className="opacity-60">·</span>
            </>
          )}
          <span>{target.resourceKind ?? target.kind}</span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-[20px] font-semibold text-main selectable">
            {target.displayName ?? target.name}
          </h1>
          <div className="flex items-center gap-1.5">
            {(target.kind === 'Pod' || target.kind === 'Service') && (
              <button
                type="button"
                onClick={() => void handleOpenPortForward()}
                disabled={portForwardLoading}
                className="text-secondary hover:text-main w-7 h-7 flex items-center justify-center rounded hover:bg-zGray-800 disabled:opacity-50"
                title="Port forward"
              >
                <Network className="w-4 h-4" strokeWidth={2} />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-secondary hover:text-main w-7 h-7 flex items-center justify-center rounded hover:bg-zGray-800"
              title="Close details"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="-mx-6 mt-4 flex gap-1 border-b border-zGray-800 px-3">
          {tabs.map((t) => (
            <button
              key={t}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                setTab(t)
              }}
              onClick={(event) => {
                // Keyboard only — pointer presses already fired at pointerdown.
                if (event.detail !== 0) return
                setTab(t)
              }}
              className={clsx(
                'px-3 py-2 text-[12.5px] -mb-px border-b-2 transition-colors',
                tab === t
                  ? 'border-zViolet-accent text-main'
                  : 'border-transparent text-secondary hover:text-main',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin selectable">
        {tab === 'Overview' && (
          <OverviewTabContent
            target={target}
            context={context}
            refreshKey={refreshKey}
            hasMatchedPods={hasMatchedPods}
            onNavigate={onNavigate}
          />
        )}
        {tab === 'Logs' && target.kind === 'Pod' && (
          <PodLogs namespace={target.namespace!} name={target.name} />
        )}
        {target.kind === 'Pod' && terminalMounted && (
          <div className={clsx('h-full min-h-0', tab === 'Terminal' ? 'flex flex-col' : 'hidden')}>
            <PodTerminalTab namespace={target.namespace!} name={target.name} />
          </div>
        )}
        {target.kind === 'Node' && terminalMounted && (
          <div className={clsx('h-full min-h-0', tab === 'Terminal' ? 'flex flex-col' : 'hidden')}>
            {/* key by node so switching nodes remounts the tab and re-shows the
                privilege confirmation (state must not carry over to another node). */}
            <NodeTerminalTab key={target.name} name={target.name} />
          </div>
        )}
        {tab === 'Logs' && hasMatchedPods && (
          <WorkloadLogsTab kind={target.kind} namespace={target.namespace!} name={target.name} />
        )}
        {tab === 'YAML' && <YamlTab target={target} refreshKey={refreshKey} />}
        {tab === 'Events' && <EventsTab target={target} refreshKey={refreshKey} />}
      </div>
    </div>
  )
}
