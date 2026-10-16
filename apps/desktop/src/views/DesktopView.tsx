import RFB from '@novnc/novnc'
import { Monitor } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { api } from '../api'
import { parseAtlasError } from '../api/errors'
import { PageMeta } from '../app/pageMeta'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { DesktopRefusal, keepDesktopConnected } from '../lib/desktopConnection'
import { IpcVncChannel } from '../lib/ipcVncChannel'
import { sessionDesktopTitle, subscribeSessionDesktops } from '../lib/sessionDesktops'

import type { DesktopAttach, DesktopPhase } from '../lib/desktopConnection'

/** What the remote page shows once its connection is over; the view then reconnects with a new link. */
const BOX_PAGE_ENDED = /link has expired|disconnected|failed to connect/iu

/** The desktop's frame: its name in the header, and what stands between the user and it. */
function DesktopFrame({
  title,
  phase,
  status,
  action,
  onRetry,
  host,
}: {
  title: string
  phase: DesktopPhase
  status?: string
  action?: React.ReactNode
  onRetry: () => void
  host: React.RefObject<HTMLDivElement | null>
}) {
  const overlay =
    phase.kind === 'connecting'
      ? 'Connecting to the desktop…'
      : phase.kind === 'reconnecting'
        ? 'Reconnecting…'
        : undefined

  return (
    <PageMeta pageKey="team.desktop" title={title} icon={<Monitor className="h-3.5 w-3.5" />}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-zGray-800 px-3 py-1.5 text-xs text-tertiary">
          <span className="max-w-[40%] shrink-0 truncate font-medium text-main" title={title}>
            {title}
          </span>
          <span className="min-w-0 flex-1 truncate">{status}</span>
          {phase.kind === 'connected' && action}
        </div>
        <div className="relative min-h-0 flex-1">
          <div ref={host} className="absolute inset-0 flex" />
          {(overlay || phase.kind === 'stopped') && (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zGray-950/80 text-sm text-secondary"
            >
              {phase.kind === 'stopped' ? phase.message : overlay}
              {phase.kind === 'stopped' && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded border border-zGray-700 px-2 py-0.5 text-xs text-main hover:bg-zGray-800"
                >
                  {phase.reason === 'offline' ? 'Resume' : 'Try again'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </PageMeta>
  )
}

/**
 * A conversation's own desktop on its Box, watched over the Box's tunnel;
 * `display` is the X display number. View-only until the owner takes it over:
 * the backend drops the viewer's input until then, and taking over also makes
 * the agent's input tools on that desktop wait. A dropped stream reconnects,
 * as the viewer again: the host hands the desktop back when a stream closes.
 */
function SessionDesktopView({ teamId, display }: { teamId: string; display: number }) {
  const { conversationId, tabId } = useWorkspaceTab()
  const host = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const channelRef = useRef<IpcVncChannel | null>(null)
  const retryRef = useRef<() => void>(() => undefined)
  const [phase, setPhase] = useState<DesktopPhase>({ kind: 'connecting' })
  const [holding, setHolding] = useState(false)
  const title = useSyncExternalStore(subscribeSessionDesktops, () =>
    conversationId ? sessionDesktopTitle(conversationId, display) : undefined,
  )

  useEffect(() => {
    const target = host.current

    if (!target || !conversationId || !tabId) return
    // The main process signs each stream with the current token; nothing is held here.
    const attach: DesktopAttach<null> = (_link, { opened, closed }) => {
      const channel = new IpcVncChannel(tabId).open({ teamId, sessionId: conversationId, display })
      const rfb = new RFB(target, channel as unknown as WebSocket, { shared: true })

      rfb.viewOnly = true
      rfb.scaleViewport = true
      rfb.background = 'transparent'
      rfb.addEventListener('connect', opened)
      rfb.addEventListener('disconnect', closed)
      rfbRef.current = rfb
      channelRef.current = channel
      setHolding(false)

      return () => {
        rfb.removeEventListener('disconnect', closed)
        rfb.disconnect()
        if (rfbRef.current === rfb) rfbRef.current = null
        if (channelRef.current === channel) channelRef.current = null
      }
    }
    const connection = keepDesktopConnected({
      mint: () => Promise.resolve(null),
      attach,
      onPhase: setPhase,
    })

    retryRef.current = connection.restart

    return connection.stop
  }, [conversationId, tabId, teamId, display])

  const toggle = () => {
    const next = !holding

    channelRef.current?.control(next ? 'human' : 'agent')
    if (rfbRef.current) rfbRef.current.viewOnly = !next
    setHolding(next)
  }

  return (
    <DesktopFrame
      title={title ?? `Desktop :${String(display)}`}
      phase={conversationId ? phase : { kind: 'connecting' }}
      status={
        !conversationId
          ? 'Select a conversation to see its desktop.'
          : phase.kind !== 'connected'
            ? undefined
            : holding
              ? 'You have the desktop; the agent’s input tools wait until you hand it back.'
              : 'Watching the agent’s desktop.'
      }
      action={
        <button
          type="button"
          onClick={toggle}
          className="rounded border border-zGray-700 px-2 py-0.5 text-main hover:bg-zGray-800"
        >
          {holding ? 'Hand back' : 'Take over'}
        </button>
      }
      onRetry={() => retryRef.current()}
      host={host}
    />
  )
}

/** A refusal names why the desktop cannot open; anything else is worth another try. */
function boxRefusal(error: unknown): unknown {
  const { code } = parseAtlasError(error)

  if (code === 'forbidden' || code === 'not_found')
    return new DesktopRefusal('denied', 'You no longer have access to this Box’s desktop.')
  if (code === 'box_state' || code === 'box_unavailable')
    return new DesktopRefusal('offline', 'Box is offline.')

  return error
}

/**
 * A Box's whole desktop, in the Box provider's own viewer. The tab names only
 * the Box: each connect asks the backend for a new short-lived link, so a link
 * that expired is never what reconnects.
 */
function BoxDesktopView({ teamId, deviceId }: { teamId: string; deviceId: string }) {
  const host = useRef<HTMLDivElement>(null)
  const retryRef = useRef<() => void>(() => undefined)
  const [phase, setPhase] = useState<DesktopPhase>({ kind: 'connecting' })
  const [label, setLabel] = useState<string>()

  useEffect(() => {
    const target = host.current

    if (!target) return
    const attach: DesktopAttach<string> = (url, { opened, closed }) => {
      const view = document.createElement('webview')

      view.setAttribute('src', url)
      view.setAttribute('partition', 'persist:browser')
      view.setAttribute('webpreferences', 'sandbox=yes,contextIsolation=yes')
      view.style.cssText = 'width:100%;height:100%;display:flex'
      const onFail = (event: Electron.DidFailLoadEvent) => {
        if (event.isMainFrame && event.errorCode !== -3) closed()
      }
      // The viewer reports its connection ending only on the page.
      const watch = setInterval(() => {
        view
          .executeJavaScript('document.body ? document.body.innerText : ""')
          .then((text: unknown) => {
            if (typeof text === 'string' && BOX_PAGE_ENDED.test(text)) closed()
          })
          .catch(() => undefined)
      }, 3000)

      view.addEventListener('did-finish-load', opened)
      view.addEventListener('did-fail-load', onFail)
      view.addEventListener('render-process-gone', closed)
      target.appendChild(view)

      return () => {
        clearInterval(watch)
        view.removeEventListener('did-finish-load', opened)
        view.removeEventListener('did-fail-load', onFail)
        view.removeEventListener('render-process-gone', closed)
        view.remove()
      }
    }
    const connection = keepDesktopConnected({
      mint: async () => {
        try {
          const desktop = await api.boxDesktop(deviceId, teamId)

          setLabel(desktop.label)

          return desktop.url
        } catch (error) {
          throw boxRefusal(error)
        }
      },
      attach,
      onPhase: setPhase,
    })

    retryRef.current = connection.restart

    return connection.stop
  }, [teamId, deviceId])

  const retry = () => {
    if (phase.kind === 'stopped' && phase.reason === 'offline')
      void api
        .boxResume(deviceId, teamId)
        .catch(() => undefined)
        .then(() => retryRef.current())
    else retryRef.current()
  }

  return <DesktopFrame title={label ?? 'Desktop'} phase={phase} onRetry={retry} host={host} />
}

/** `filter` is a session's X display number, or the Box whose whole desktop this is. */
export function DesktopView({ teamId, filter }: { teamId: string; filter: string }) {
  if (!filter)
    return (
      <PageMeta pageKey="team.desktop" title="Desktop" icon={<Monitor className="h-3.5 w-3.5" />}>
        <p role="status" className="p-4 text-sm text-secondary">
          Open a running Box’s desktop from Agents.
        </p>
      </PageMeta>
    )

  return /^\d+$/u.test(filter) ? (
    <SessionDesktopView teamId={teamId} display={Number(filter)} />
  ) : (
    <BoxDesktopView teamId={teamId} deviceId={filter} />
  )
}
