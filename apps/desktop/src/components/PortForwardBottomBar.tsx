import { ArrowLeftRight, Check, Copy, ExternalLink, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../api'
import { reportFrontendError } from '../lib/frontendErrorReporter'
import { PORT_FORWARD_LIST_OPEN_EVENT } from '../lib/portForwardList'

import { Age } from './Age'
import { Modal } from './Modal'

import type { PortForwardEvent, PortForwardInfo } from '../types'

function applyPortForwardEvent(
  forwards: PortForwardInfo[],
  event: PortForwardEvent,
): PortForwardInfo[] {
  if (event.type === 'started') {
    if (forwards.some((item) => item.id === event.info.id)) return forwards

    return [...forwards, event.info]
  }
  if (event.type === 'stopped') {
    return forwards.filter((item) => item.id !== event.info.id)
  }
  console.error('[port-forward] tunnel error:', event.error)
  reportFrontendError({
    source: 'port_forward',
    phase: 'tunnel_event_error',
    message: event.error ?? 'Port-forward tunnel failed.',
  })

  return forwards
}

type Props = {
  onActiveChange?: (active: boolean) => void
}

export function PortForwardBottomBar({ onActiveChange }: Props) {
  const [forwards, setForwards] = useState<PortForwardInfo[]>([])
  const [hasLoadedForwards, setHasLoadedForwards] = useState(false)
  const [open, setOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let initialized = false
    const bufferedEvents: PortForwardEvent[] = []
    const off = api.onPortForwardEvent((event: PortForwardEvent) => {
      if (!initialized) {
        bufferedEvents.push(event)

        return
      }
      setForwards((prev) => applyPortForwardEvent(prev, event))
    })

    api
      .k8sListPortForwards()
      .then((list) => {
        initialized = true
        if (!cancelled) {
          setForwards(bufferedEvents.reduce(applyPortForwardEvent, list))
          setHasLoadedForwards(true)
        }
      })
      .catch(() => {
        initialized = true
        if (!cancelled) {
          setForwards((prev) => bufferedEvents.reduce(applyPortForwardEvent, prev))
          setHasLoadedForwards(true)
        }
      })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  // The list can't stay open once the last forward is gone.
  const noForwards = hasLoadedForwards && forwards.length === 0
  const [wasEmpty, setWasEmpty] = useState(noForwards)

  if (noForwards !== wasEmpty) {
    setWasEmpty(noForwards)
    if (noForwards) setOpen(false)
  }

  useEffect(() => {
    if (!hasLoadedForwards) return
    onActiveChange?.(forwards.length > 0)
  }, [forwards.length, hasLoadedForwards, onActiveChange])

  useEffect(() => {
    function handleOpenList() {
      setOpen(true)
    }
    window.addEventListener(PORT_FORWARD_LIST_OPEN_EVENT, handleOpenList)

    return () => window.removeEventListener(PORT_FORWARD_LIST_OPEN_EVENT, handleOpenList)
  }, [])

  async function handleStop(id: string) {
    await api.k8sStopPortForward(id).catch((e: unknown) => {
      console.error('[port-forward] stop failed:', e)
    })
  }

  async function handleCopy(id: string, localPort: number) {
    await navigator.clipboard.writeText(`localhost:${String(localPort)}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500)
  }

  async function handleOpen(localPort: number) {
    await api.appOpenExternal(`http://localhost:${String(localPort)}`)
  }

  if (forwards.length === 0) return null

  const first = forwards[0]
  const label =
    forwards.length === 1
      ? '1 active port forward'
      : `${String(forwards.length)} active port forwards`
  const detail = first
    ? `localhost:${String(first.localPort)} -> ${first.namespace}/${first.podName}:${String(first.targetPort)}`
    : ''

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-8 w-full flex-shrink-0 titlebar-no-drag bg-zViolet-500 text-white shadow-[0_-10px_30px_rgba(0,0,0,0.25)] hover:bg-zViolet-400 transition-colors"
        title="Show current port forwards"
      >
        <span className="mx-auto flex h-full max-w-5xl items-center justify-center gap-2 px-4 text-[12.5px]">
          <ArrowLeftRight className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
          <span className="font-medium">{label}</span>
          <span className="hidden min-w-0 truncate font-mono text-[11.5px] text-white/80 sm:inline">
            {detail}
          </span>
        </span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Port forwards"
        description="Current local tunnels"
        width={620}
      >
        <div className="flex flex-col divide-y divide-zGray-800">
          {forwards.map((forward) => (
            <div key={forward.id} className="flex items-center gap-3 px-5 py-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-zViolet-500/15 text-zViolet-accent">
                <ArrowLeftRight className="h-4 w-4" strokeWidth={1.9} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-main">
                    {forward.podName}
                  </span>
                  <span className="flex-shrink-0 text-[11.5px] text-tertiary">
                    {forward.namespace}
                  </span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px]">
                  <span className="truncate font-mono text-main">
                    localhost:{forward.localPort}
                  </span>
                  <span className="text-tertiary">-&gt;</span>
                  <span className="truncate font-mono text-secondary">
                    pod:{forward.targetPort}
                  </span>
                  <span className="text-tertiary">·</span>
                  <span className="flex-shrink-0 text-tertiary">
                    <Age value={forward.startedAt} />
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy(forward.id, forward.localPort)}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-zGray-800 hover:text-main"
                title="Copy local address"
              >
                {copiedId === forward.id ? (
                  <Check className="h-3.5 w-3.5 text-success" strokeWidth={2} />
                ) : (
                  <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                )}
              </button>
              <button
                type="button"
                onClick={() => void handleOpen(forward.localPort)}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-zGray-800 hover:text-main"
                title="Open in browser"
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => void handleStop(forward.id)}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-error/10 hover:text-error"
                title="Stop port-forward"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
