import { api } from '../api'

import type { DesktopTarget } from '../api/local-terminal-types'

type Handler<E> = ((event: E) => void) | null

function toBytes(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  return bytes.buffer
}

function toBase64(data: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  let binary = ''

  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary)
}

/**
 * The WebSocket surface noVNC attaches to, over the main process's socket to a
 * conversation's desktop: frames cross IPC as base64 and become the bytes RFB
 * expects here. Taking the desktop over is a control frame on the same stream.
 */
export class IpcVncChannel {
  readyState: number = WebSocket.CONNECTING
  binaryType = 'arraybuffer'
  protocol = ''
  onopen: Handler<Event> = null
  onmessage: Handler<{ data: ArrayBuffer }> = null
  onclose: Handler<CloseEvent> = null
  onerror: Handler<Event> = null
  private readonly id: string
  private readonly stop: () => void

  constructor(id: string) {
    this.id = id
    this.stop = api.onRuntimeDesktopEvent((event) => {
      if (event.id !== id) return
      if (event.type === 'open') {
        this.readyState = WebSocket.OPEN
        this.onopen?.(new Event('open'))
      } else if (event.type === 'data') this.onmessage?.({ data: toBytes(event.data) })
      else this.finish()
    })
  }

  /** Asks the main process for the socket; the stream's `open` arrives as an event. */
  open(target: DesktopTarget): this {
    api.runtimeDesktopStart(this.id, target).catch(() => {
      this.finish()
    })

    return this
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.readyState === WebSocket.OPEN) void api.runtimeDesktopInput(this.id, toBase64(data))
  }

  /** Who holds the desktop: a human viewer pauses the agent's input tools on it. */
  control(owner: 'human' | 'agent'): void {
    if (this.readyState === WebSocket.OPEN)
      void api.runtimeDesktopInput(this.id, JSON.stringify({ t: 'control', owner }))
  }

  close(): void {
    void api.runtimeDesktopClose(this.id)
    this.finish()
  }

  private finish(): void {
    if (this.readyState === WebSocket.CLOSED) return
    this.readyState = WebSocket.CLOSED
    this.stop()
    this.onclose?.(new CloseEvent('close'))
  }
}
