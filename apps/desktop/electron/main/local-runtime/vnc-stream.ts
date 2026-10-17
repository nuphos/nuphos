import { readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import path from 'node:path'

import type { SocketEvent, SocketLike } from './tunnel-client.ts'
import type { Socket } from 'node:net'

type Listener = (event: SocketEvent) => void

/** Xvnc for display :N listens on this port plus N (desktop-session.mjs). */
const VNC_BASE_PORT = 5900
/** The computer-use proxy forgets a human owner 30 s after the last renewal. */
const CONTROL_RENEW_MS = 20_000
/** Well inside the reaper's grace for a desktop opened by hand (desktop-session.mjs). */
const WATCHING_MS = 60_000

/**
 * One viewer of one session's desktop, multiplexed on the device tunnel like
 * the other streams. The first frame names the session, the display and the
 * viewer, and the display is connected only if its lock is that session's.
 * From then on frames are RFB bytes in base64 both ways: the viewer is the
 * owner and may always type. A control frame from the viewer hands the desktop
 * to them or back to the agent: while a human holds it, that display's
 * computer-use proxy refuses input tools. The stream closing hands it back.
 * Two viewers of one desktop share the lock, last writer wins.
 */
export class VncStream implements SocketLike {
  readyState = 0
  private readonly listeners = new Map<string, Set<Listener>>()
  private socket: Socket | undefined
  /** The display's control file, once the display is known. */
  private control = ''
  private viewer = ''
  private renew: ReturnType<typeof setInterval> | undefined
  private watching: ReturnType<typeof setInterval> | undefined
  /** The display's lock names another session now. */
  private lost = false
  private held = () => false
  private readonly pool: string
  private readonly port: (display: number) => number

  constructor(pool: string, port = (display: number) => VNC_BASE_PORT + display) {
    this.pool = pool
    this.port = port
    queueMicrotask(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()

    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  send(data: string): void {
    if (this.readyState !== 1) return
    if (!data.startsWith('{')) {
      this.socket?.write(Buffer.from(data, 'base64'))

      return
    }
    try {
      const frame = JSON.parse(data) as {
        t?: string
        sessionId?: string
        display?: number
        viewer?: string
        owner?: string
      }
      const { display, sessionId } = frame

      if (frame.t === 'open' && !this.socket && sessionId && typeof display === 'number')
        this.open(sessionId, display, frame.viewer ?? '')
      else if (frame.t === 'control' && this.control) this.handOver(frame.owner === 'human')
      else throw new Error('Invalid desktop frame')
    } catch {
      this.close()
    }
  }

  /** The lock file is the authority on whose display this is (desktop-session.mjs). */
  private holder(display: number): string | undefined {
    try {
      const lock = JSON.parse(
        readFileSync(path.join(this.pool, `${String(display)}.lock`), 'utf8'),
      ) as { sessionId?: string }

      return lock.sessionId
    } catch {
      return undefined
    }
  }

  private open(sessionId: string, display: number, viewer: string): void {
    if (this.holder(display) !== sessionId) throw new Error('Not this session’s display')
    this.viewer = viewer.replace(/[^\w-]/gu, '')
    this.control = path.join(this.pool, `${String(display)}.xdg`, 'instabox-control')
    this.held = () => this.holder(display) === sessionId
    // Someone is watching: a desktop opened by hand is not idle.
    const lock = path.join(this.pool, `${String(display)}.lock`)
    const touch = () => {
      if (!this.stillHeld()) return
      try {
        utimesSync(lock, new Date(), new Date())
      } catch {
        // The desktop is gone; the stream ends with its socket.
      }
    }

    touch()
    this.watching = setInterval(touch, WATCHING_MS)
    const socket = connect(this.port(display), '127.0.0.1')

    this.socket = socket
    socket.on('data', (chunk: Buffer) => this.emit('message', { data: chunk.toString('base64') }))
    socket.on('close', () => this.close())
    socket.on('error', () => this.close())
  }

  /** The lock the proxy reads: a human owner must be renewed; the agent needs no entry. */
  private handOver(toHuman: boolean): void {
    clearInterval(this.renew)
    this.renew = undefined
    const write = () => {
      if (!this.stillHeld()) return
      try {
        writeFileSync(
          this.control,
          toHuman ? `human ${this.viewer} ${String(Math.floor(Date.now() / 1000))}\n` : 'agent\n',
        )
      } catch {
        // The desktop is gone; the stream ends with its socket.
      }
    }

    write()
    if (toHuman) this.renew = setInterval(write, CONTROL_RENEW_MS)
  }

  /** False, and the stream ended, once the display went to another session: its lock and control are not ours. */
  private stillHeld(): boolean {
    if (!this.lost && !this.held()) {
      this.lost = true
      this.close()
    }

    return !this.lost
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    // Hands back only a desktop still this session's; another's lock is not ours to write.
    if (this.renew && !this.lost) this.handOver(false)
    clearInterval(this.renew)
    clearInterval(this.watching)
    this.socket?.destroy()
    this.emit('close', { code: 1000 })
    this.listeners.clear()
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
