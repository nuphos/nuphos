import RFB from '@novnc/novnc'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { api } from '../api'
import { parseAtlasError } from '../api/errors'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { t } from '../i18n'
import { DesktopRefusal, keepDesktopConnected } from '../lib/desktopConnection'
import { IpcVncChannel } from '../lib/ipcVncChannel'
import {
  desktopTabSession,
  sessionDesktopTitle,
  subscribeSessionDesktops,
} from '../lib/sessionDesktops'

import { DesktopFrame } from './DesktopFrame'
import { openBoxPaywall } from './settings/boxPaywallStore'

import type { DesktopAttach, DesktopPhase } from '../lib/desktopConnection'

/** What the remote page shows once its connection is over; the view then reconnects with a new link. */
const BOX_PAGE_ENDED = /link has expired|disconnected|failed to connect/iu

/** A Box pauses the agent's input tools while the owner holds its display; a Mac's screen (:0) does not. */
const holdingStatus = (display: number) =>
  display === 0
    ? t('You have the Mac’s screen; the agent can still use it too.')
    : t('You have the desktop; the agent’s input tools wait until you hand it back.')

/**
 * A conversation's own desktop on its Box, watched over the Box's tunnel;
 * `display` is the X display number, or 0 for a Mac's own screen, which
 * Nuphos serves itself with no Mac account. View-only until the owner takes it over:
 * the backend drops the viewer's input until then, and taking over also makes
 * the agent's input tools on that desktop wait. A dropped stream reconnects,
 * as the viewer again: the host hands the desktop back when a stream closes.
 */
export function SessionDesktopView({
  teamId,
  display,
  sessionId,
  switcher,
}: {
  teamId: string
  display: number
  /** Another of the viewer's conversations on the Box; else the one whose tab this is. */
  sessionId?: string
  switcher?: React.ReactNode
}) {
  const { tabId } = useWorkspaceTab()
  // From the tab, not the chat on screen: a dock keeps other sessions' desktop tabs mounted.
  const conversationId = sessionId ?? desktopTabSession(tabId)
  const host = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const channelRef = useRef<IpcVncChannel | null>(null)
  const retryRef = useRef<() => void>(() => {})
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

    return () => {
      connection.stop()
    }
  }, [conversationId, tabId, teamId, display])

  const toggle = () => {
    const next = !holding

    channelRef.current?.control(next ? 'human' : 'agent')
    if (rfbRef.current) rfbRef.current.viewOnly = !next
    setHolding(next)
  }

  return (
    <DesktopFrame
      title={title ?? t('Desktop :{display}', { display: String(display) })}
      phase={conversationId ? phase : { kind: 'connecting' }}
      status={
        !conversationId
          ? t('Select an agent to see its desktop.')
          : phase.kind !== 'connected'
            ? undefined
            : holding
              ? holdingStatus(display)
              : t('Watching the agent’s desktop.')
      }
      action={
        <button
          type="button"
          onClick={toggle}
          className="rounded border border-zGray-700 px-2 py-0.5 text-main hover:bg-zGray-800"
        >
          {holding ? t('Hand back') : t('Take over')}
        </button>
      }
      switcher={switcher}
      onRetry={() => retryRef.current()}
      host={host}
    />
  )
}

/** A refusal names why the desktop cannot open; anything else is worth another try. */
function boxRefusal(error: unknown): unknown {
  const { code } = parseAtlasError(error)

  if (code === 'forbidden' || code === 'not_found')
    return new DesktopRefusal('denied', t('You no longer have access to this computer’s desktop.'))
  if (code === 'box_state' || code === 'box_unavailable')
    return new DesktopRefusal('offline', t('Computer is offline.'))

  return error
}

/**
 * A Box's whole desktop, in the Box provider's own viewer. The tab names only
 * the Box: each connect asks the backend for a new short-lived link, so a link
 * that expired is never what reconnects.
 */
export function BoxDesktopView({
  teamId,
  deviceId,
  switcher,
}: {
  teamId: string
  deviceId: string
  switcher?: React.ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const retryRef = useRef<() => void>(() => {})
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
          .catch(() => {})
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
        // A Box the plan has no room for: the paywall offers one, then tries again.
        .catch((error: unknown) => {
          openBoxPaywall(teamId, error, retry)
        })
        .then(() => retryRef.current())
    else retryRef.current()
  }

  return (
    <DesktopFrame
      title={label ?? t('Desktop')}
      phase={phase}
      switcher={switcher}
      onRetry={retry}
      host={host}
    />
  )
}
