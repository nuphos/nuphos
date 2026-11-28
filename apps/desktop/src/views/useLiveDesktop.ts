import { useEffect, useRef, useState } from 'react'

import { keepDesktopConnected } from '../lib/desktopConnection'
import { IpcVncChannel } from '../lib/ipcVncChannel'

import type { DesktopAttach, DesktopPhase } from '../lib/desktopConnection'
import type RFB from '@novnc/novnc'

/** How long an attempt has to show its first picture, the handshake included. */
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

/**
 * A conversation's desktop, live: noVNC over the main process's stream `id`,
 * view-only until `hold(true)` takes it over. Nothing is kept of what it shows.
 * A dropped stream reconnects as a viewer again: the host hands the desktop back
 * when a stream closes.
 */
export function useLiveDesktop(
  id: string | undefined,
  target: { teamId: string; sessionId: string | undefined; display: number },
) {
  const { teamId, sessionId, display } = target
  const host = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const channelRef = useRef<IpcVncChannel | null>(null)
  const retryRef = useRef<() => void>(() => {})
  const [phase, setPhase] = useState<DesktopPhase>({ kind: 'connecting' })
  const [holding, setHolding] = useState(false)

  useEffect(() => {
    const element = host.current

    if (!element || !sessionId || !id) return
    // The main process signs each stream with the current token; nothing is held here.
    const attach =
      (Rfb: typeof RFB): DesktopAttach<null> =>
      (_link, { opened, closed }) => {
        const channel = new IpcVncChannel(id).open({ teamId, sessionId, display })
        const rfb = new Rfb(element, channel as unknown as WebSocket, { shared: true })

        rfb.viewOnly = true
        rfb.scaleViewport = true
        rfb.background = 'transparent'
        // Connected once the desktop shows: a stream that never draws counts as a failed
        // attempt, so it says so instead of staying blank. The clock starts with the
        // attempt, not the handshake: a stream that opens and then never answers would
        // otherwise leave it waiting forever.
        const stopWaiting = awaitPicture(element, opened, closed)

        rfb.addEventListener('disconnect', closed)
        rfbRef.current = rfb
        channelRef.current = channel
        setHolding(false)

        return () => {
          stopWaiting()
          rfb.removeEventListener('disconnect', closed)
          rfb.disconnect()
          if (rfbRef.current === rfb) rfbRef.current = null
          if (channelRef.current === channel) channelRef.current = null
        }
      }
    let connection: { stop: () => void } | undefined
    let stopped = false

    // noVNC only where a desktop is shown: it is loaded with the first one.
    void import('@novnc/novnc').then(({ default: Rfb }) => {
      if (stopped) return
      const started = keepDesktopConnected({
        mint: () => Promise.resolve(null),
        attach: attach(Rfb),
        onPhase: setPhase,
      })

      connection = started
      retryRef.current = started.restart
    })

    return () => {
      stopped = true
      connection?.stop()
    }
  }, [id, sessionId, teamId, display])

  /** Takes the desktop over, or hands it back to the agent. */
  const hold = (next: boolean) => {
    channelRef.current?.control(next ? 'human' : 'agent')
    if (rfbRef.current) rfbRef.current.viewOnly = !next
    setHolding(next)
  }

  return { host, phase, holding, hold, retry: () => retryRef.current() }
}
