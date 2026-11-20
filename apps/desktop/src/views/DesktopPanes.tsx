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

/** How long a connected desktop has to show its first picture. */
const FIRST_PICTURE_MS = 8_000

/**
 * Calls `shown` once noVNC's canvas, transparent until a frame lands on it, has a
 * picture, or `failed` if none comes in time; returns how to stop waiting.
 */
function awaitPicture(host: HTMLElement, shown: () => void, failed: () => void): () => void {
  const since = Date.now()
  const timer = setInterval(() => {
    const canvas = host.querySelector('canvas')
    const drawn = canvas?.width
      ? canvas.getContext('2d')?.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data[3]
      : 0

    if (drawn) shown()
    else if (Date.now() - since < FIRST_PICTURE_MS) return
    else failed()
    clearInterval(timer)
  }, 250)

  return () => {
    clearInterval(timer)
  }
}

/** A Box pauses the agent's input tools while the owner holds its display; a Mac's screen (:0) does not. */
const holdingStatus = (display: number) =>
  display === 0
    ? t('You have the Mac’s screen; Nuphos can still use it too.')
    : t('You have the desktop; Nuphos’s input tools wait until you hand it back.')

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
      // Connected once the desktop shows: a stream that never draws counts as a failed
      // attempt, so the tab says so instead of staying blank.
      let stopWaiting: (() => void) | undefined

      rfb.addEventListener('connect', () => {
        stopWaiting = awaitPicture(target, opened, closed)
      })
      rfb.addEventListener('disconnect', closed)
      rfbRef.current = rfb
      channelRef.current = channel
      setHolding(false)

      return () => {
        stopWaiting?.()
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
          ? t('Select a runtime to see its desktop.')
          : phase.kind !== 'connected'
            ? undefined
            : holding
              ? holdingStatus(display)
              : t('Watching the runtime’s desktop.')
      }
      action={
        <button
          type="button"
          onClick={toggle}
          className="rounded border border-line-control px-2 py-0.5 text-main hover:bg-state-hover"
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
  const { code, message } = parseAtlasError(error)

  if (code === 'forbidden' || code === 'not_found')
    return new DesktopRefusal('denied', t('You no longer have access to this computer’s desktop.'))
  if (code === 'box_state') return new DesktopRefusal('offline', t('Computer is offline.'))
  // The backend's own words: the instabox account, its key or an outage, not the Box being off.
  if (code === 'box_unavailable' || code === 'instabox_key_rejected')
    return new DesktopRefusal('offline', message)

  return error
}

/**
 * A Box's whole desktop, streamed from instabox through the backend and shown
 * with noVNC, as a conversation's desktop is. Each connect starts the desktop
 * again first, so one that stopped is what a reconnect brings back.
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
  const { tabId } = useWorkspaceTab()
  const host = useRef<HTMLDivElement>(null)
  const retryRef = useRef<() => void>(() => {})
  const [phase, setPhase] = useState<DesktopPhase>({ kind: 'connecting' })
  const [label, setLabel] = useState<string>()

  useEffect(() => {
    const target = host.current

    if (!target || !tabId) return
    // The main process signs the stream with the current token; nothing is held here.
    const attach: DesktopAttach<null> = (_link, { opened, closed }) => {
      const channel = new IpcVncChannel(tabId).open({ teamId, boxId: deviceId })
      const rfb = new RFB(target, channel as unknown as WebSocket, { shared: true })

      rfb.scaleViewport = true
      rfb.background = 'transparent'
      let stopWaiting: (() => void) | undefined

      rfb.addEventListener('connect', () => {
        stopWaiting = awaitPicture(target, opened, closed)
      })
      rfb.addEventListener('disconnect', closed)

      return () => {
        stopWaiting?.()
        rfb.removeEventListener('disconnect', closed)
        rfb.disconnect()
      }
    }
    const connection = keepDesktopConnected({
      mint: async () => {
        try {
          const desktop = await api.boxDesktop(deviceId, teamId)

          setLabel(desktop.label)

          return null
        } catch (error) {
          throw boxRefusal(error)
        }
      },
      attach,
      onPhase: setPhase,
    })

    retryRef.current = connection.restart

    return connection.stop
  }, [teamId, deviceId, tabId])

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
