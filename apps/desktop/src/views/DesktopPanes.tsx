import RFB from '@novnc/novnc'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { api } from '../api'
import { parseAtlasError } from '../api/errors'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { t } from '../i18n'
import { keepDesktopConnected } from '../lib/desktopConnection'
import { IpcVncChannel } from '../lib/ipcVncChannel'
import {
  desktopTabSession,
  sessionDesktopTitle,
  subscribeSessionDesktops,
} from '../lib/sessionDesktops'

import { DesktopFrame } from './DesktopFrame'

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

/**
 * A Box's own desktop, for its owner: its host opens one on request, as any of their
 * computers does (runtime-desktop.ts), and it is watched like a conversation's. Without
 * the host's runtime id there is nothing to open: the Box is away, or it is not theirs.
 */
export function BoxDesktopView({
  teamId,
  runtimeId,
  switcher,
}: {
  teamId: string
  /** Undefined until the device list has loaded; null when it offers none. */
  runtimeId: string | null | undefined
  switcher?: React.ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [opened, setOpened] = useState<{ key: string; display?: number; error?: string }>()
  const sessionId = runtimeId ? `runtime/${runtimeId}` : undefined
  const key = `${sessionId ?? ''}#${String(attempt)}`
  const current = opened?.key === key ? opened : undefined

  useEffect(() => {
    if (!sessionId) return
    api.openSessionDesktop(teamId, sessionId).then(
      ({ display }) => setOpened({ key, display }),
      (error: unknown) => setOpened({ key, error: parseAtlasError(error).message }),
    )
  }, [teamId, sessionId, key])

  if (sessionId && current?.display !== undefined)
    return (
      <SessionDesktopView
        teamId={teamId}
        display={current.display}
        sessionId={sessionId}
        switcher={switcher}
      />
    )
  const message = runtimeId === null ? t('Computer is offline.') : current?.error

  return (
    <DesktopFrame
      title={t('Desktop')}
      phase={message ? { kind: 'stopped', reason: 'offline', message } : { kind: 'connecting' }}
      switcher={switcher}
      onRetry={() => setAttempt((n) => n + 1)}
      host={host}
    />
  )
}
