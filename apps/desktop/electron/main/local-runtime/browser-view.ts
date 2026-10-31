import {
  PageScreen,
  ZrleEncoder,
  be32,
  refusalMessage,
  serverInitMessage,
  updateMessage,
} from './rfb-encode.ts'
import { PageInput, clientMessageLength } from './rfb-input.ts'

import type { SocketEvent, SocketLike } from './tunnel-client.ts'
import type { WebContents } from 'electron'

type Listener = (event: SocketEvent) => void

/** What the stream needs of a dock tab's page. */
export type ViewedPage = Pick<
  WebContents,
  | 'isDestroyed'
  | 'beginFrameSubscription'
  | 'endFrameSubscription'
  | 'invalidate'
  | 'sendInputEvent'
  | 'once'
  | 'executeJavaScript'
>

/**
 * Finds the conversation's dock tab and starts it painting at the phone's size.
 * `end` lets the Mac end the stream (its Stop button). A refusal carries the
 * reason the phone shows; null closes the stream.
 */
export type WatchTab = (
  session: string,
  tab: string,
  width: number,
  height: number,
  end: () => void,
) => Promise<{ page: ViewedPage; stop: () => void } | { refused: string } | null>

/** The smallest and largest page a phone may ask for, in CSS pixels. */
const MIN_SIDE = 200
const MAX_SIDE = 2000

/** At most about 30 updates a second, so an animating page can't keep the main process busy. */
const MIN_UPDATE_MS = 33

const clampSide = (value: unknown) =>
  Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(Number(value) || 0)))

/**
 * One phone watching one dock browser tab, on the device tunnel's `browserView`
 * stream. The first frame names the conversation, the dock tab and the page
 * size; then frames are RFB 3.8 bytes in base64 both ways, security None (the
 * backend admits only the conversation's owner), the same as the iPhone's
 * desktop viewer speaks. Frames come from the page's own compositor and input
 * goes to the page itself, so the Mac's pointer and keyboard are never touched.
 * Pull model: one update goes out per request, holding everything that changed
 * since the last one, so a slow phone sees the present instead of a queue.
 */
export class BrowserViewStream implements SocketLike {
  readyState = 0
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly watch: WatchTab
  private page: ViewedPage | undefined
  private stopWatching: (() => void) | undefined
  /** Why the Mac turned this phone away, told in the handshake so it does not retry. */
  private refusal: string | undefined
  /** Bytes from the phone not yet read as a message. */
  private received = Buffer.alloc(0)
  /** `ready`: ClientInit arrived but no frame yet, and ServerInit needs the page's size. */
  private phase: 'version' | 'security' | 'init' | 'ready' | 'messages' = 'version'
  private readonly screen = new PageScreen()
  private readonly zrle = new ZrleEncoder()
  private input: PageInput | undefined
  private resized = false
  private wantsUpdate = false
  private sending = false
  private lastUpdate = 0
  private later: ReturnType<typeof setTimeout> | undefined

  constructor(watch: WatchTab) {
    this.watch = watch
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
    if (data.startsWith('{')) {
      this.frame(data)

      return
    }
    if (!this.page && !this.refusal) return
    this.received = Buffer.concat([this.received, Buffer.from(data, 'base64')])
    try {
      this.read()
    } catch {
      this.close()
    }
  }

  private frame(data: string): void {
    let frame: { t?: string; sessionId?: string; tab?: string; width?: number; height?: number }

    try {
      frame = JSON.parse(data) as typeof frame
    } catch {
      this.close()

      return
    }
    // A control frame hands input to the phone; the page takes it either way.
    if (frame.t === 'control') return
    if (frame.t !== 'open' || this.page || !frame.sessionId || !frame.tab) {
      this.close()

      return
    }
    void this.open(frame.sessionId, frame.tab, clampSide(frame.width), clampSide(frame.height))
  }

  private async open(session: string, tab: string, width: number, height: number) {
    const watched = await this.watch(session, tab, width, height, () => this.close()).catch(
      () => null,
    )

    if (watched && 'refused' in watched) {
      this.refusal = watched.refused
      this.out(Buffer.from('RFB 003.008\n'))

      return
    }
    if (!watched || this.readyState !== 1) {
      watched?.stop()
      this.close()

      return
    }
    this.page = watched.page
    this.input = new PageInput(watched.page)
    this.stopWatching = watched.stop
    this.page.once('destroyed', () => this.close())
    this.page.beginFrameSubscription(true, (image, dirty) => {
      this.paint(image, dirty)
    })
    // A still page paints nothing on its own; the first frame starts the handshake below.
    this.page.invalidate()
    this.out(Buffer.from('RFB 003.008\n'))
  }

  /** Copies the repainted area into the screen and answers a waiting request. */
  private paint(
    image: Parameters<PageScreen['paint']>[0],
    dirty: Parameters<PageScreen['paint']>[1],
  ): void {
    if (this.screen.paint(image, dirty)) {
      this.input?.fit(this.screen.width)
      this.resized = this.phase === 'messages'
    }
    if (this.phase === 'ready') this.serverInit()
    else this.flush()
  }

  private read(): void {
    for (;;) {
      if (this.phase === 'version') {
        if (this.received.length < 12) return
        this.take(12)
        if (this.refusal) {
          this.out(refusalMessage(this.refusal))
          this.close()

          return
        }
        this.out(Buffer.from([1, 1]))
        this.phase = 'security'
      } else if (this.phase === 'security') {
        if (this.received.length < 1) return
        if (this.take(1)[0] !== 1) throw new Error('security')
        this.out(Buffer.from(be32(0)))
        this.phase = 'init'
      } else if (this.phase === 'init') {
        if (this.received.length < 1) return
        this.take(1)
        this.phase = 'ready'
        if (this.screen.width > 0) this.serverInit()

        return
      } else if (this.phase === 'ready' || !this.message()) return
    }
  }

  private serverInit(): void {
    this.phase = 'messages'
    this.out(serverInitMessage(this.screen, 'Nuphos tab'))
    this.read()
  }

  /** One client message, if all of it has arrived. */
  private message(): boolean {
    const bytes = this.received

    const length = clientMessageLength(bytes)

    if (length === null || bytes.length < length) return false
    const type = bytes.readUInt8(0)
    const message = this.take(length)

    if (type === 3) {
      // A full request redraws everything; an incremental one waits for a change.
      if (message[1] === 0) this.screen.invalidate()
      this.wantsUpdate = true
      this.flush()
    } else if (type === 4) this.input?.key(message[1] === 1, message.readUInt32BE(4))
    else if (type === 5)
      this.input?.pointer(message[1], message.readUInt16BE(2), message.readUInt16BE(4))

    return true
  }

  private take(length: number): Buffer {
    const head = this.received.subarray(0, length)

    this.received = this.received.subarray(length)

    return head
  }

  /** Sends what changed, once the phone asked and nothing is on its way. */
  private flush(): void {
    if (!this.wantsUpdate || this.phase !== 'messages' || this.sending || this.readyState !== 1)
      return
    if (!this.screen.changed && !this.resized) return
    const wait = this.lastUpdate + MIN_UPDATE_MS - Date.now()

    if (wait > 0) {
      this.later ??= setTimeout(() => {
        this.later = undefined
        this.flush()
      }, wait)

      return
    }
    this.lastUpdate = Date.now()
    const rect = this.screen.take()
    const resized = this.resized

    this.wantsUpdate = false
    this.resized = false
    this.sending = true
    void (rect ? this.zrle.encode(this.screen, rect) : Promise.resolve(null))
      .then((zrle) => this.out(updateMessage(this.screen, rect, zrle, resized)))
      .catch(() => this.close())
      .finally(() => {
        this.sending = false
        this.flush()
      })
  }

  private out(bytes: Buffer): void {
    if (this.readyState === 1) this.emit('message', { data: bytes.toString('base64') })
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    clearTimeout(this.later)
    if (this.page && !this.page.isDestroyed()) this.page.endFrameSubscription()
    this.stopWatching?.()
    this.zrle.close()
    this.emit('close', { code: 1000 })
    this.listeners.clear()
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
