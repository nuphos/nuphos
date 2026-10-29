import { failed } from './cua-host.ts'
import { fitFrame } from './cua-stream.ts'

import type { CuaToolResult } from './cua-host.ts'
import type { SocketEvent, SocketLike } from './tunnel-client.ts'

type Listener = (event: SocketEvent) => void

export type BrowserCall = {
  action: 'tabs' | 'open' | 'navigate' | 'eval' | 'screenshot'
  team: string
  /** The conversation calling; it sees and drives only the tabs it opened. */
  session: string
  tab?: number
  url?: string
  script?: string
}

/**
 * One `local_browser` call on the device tunnel, in the `local_cua` frame
 * shape: the backend sends `{t:'call'}`, the result closes the stream.
 */
export class LocalBrowserStream implements SocketLike {
  readyState = 0
  private readonly listeners = new Map<string, Set<Listener>>()
  private started = false
  private readonly run: (call: BrowserCall) => Promise<CuaToolResult>

  constructor(run: (call: BrowserCall) => Promise<CuaToolResult>) {
    this.run = run
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
    if (this.readyState !== 1 || this.started) return
    let message: { t?: string } & BrowserCall

    try {
      message = JSON.parse(data) as typeof message
    } catch {
      return
    }
    if (message.t !== 'call') return
    this.started = true
    void this.run(message)
      .catch((error: unknown) => failed(error instanceof Error ? error.message : String(error)))
      .then((result) => {
        if (this.readyState !== 1) return
        this.emit('message', { data: JSON.stringify({ t: 'result', result: fitFrame(result) }) })
        this.close()
      })
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.emit('close', { code: 1000 })
    this.listeners.clear()
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
