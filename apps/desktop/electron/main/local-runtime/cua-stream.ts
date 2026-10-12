import { randomUUID } from 'node:crypto'

import { CuaHost, cuaServerConfig, failed } from './cua-host.ts'
import { LocalExecStream } from './exec-stream.ts'

import type { CuaCall, CuaToolResult, ServerConfig } from './cua-host.ts'
import type { SocketEvent, SocketLike } from './tunnel-client.ts'

type Listener = (event: SocketEvent) => void

const hosts = new Map<string, CuaHost>()

/**
 * One `local_cua` call on the device tunnel. The backend sends the call, then
 * answers each approval prompt this stream forwards; the result closes it.
 */
export class LocalCuaStream implements SocketLike {
  readyState = 0
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly abort = new AbortController()
  private readonly replies = new Map<string, (accept: boolean) => void>()
  private started = false

  private readonly deps: {
    config: () => ServerConfig | null
    host: (session: string, config: ServerConfig) => CuaHost
  }

  constructor(
    deps = {
      config: () => cuaServerConfig(),
      host: (session: string, config: ServerConfig): CuaHost =>
        new CuaHost(session, config, () => hosts.delete(session)),
    },
  ) {
    this.deps = deps
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
    let message: { t?: string; id?: string; accept?: boolean } & Partial<CuaCall>

    try {
      message = JSON.parse(data) as typeof message
    } catch {
      return
    }
    if (message.t === 'elicit-reply' && message.id) {
      this.replies.get(message.id)?.(message.accept === true)
      this.replies.delete(message.id)

      return
    }
    if (message.t !== 'call' || this.started || !message.session || !message.turn) return
    this.started = true
    void this.run(message as CuaCall).then((result) => {
      if (this.readyState !== 1) return
      this.emit('message', { data: JSON.stringify({ t: 'result', result }) })
      this.close()
    })
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.abort.abort()
    for (const reply of this.replies.values()) reply(false)
    this.replies.clear()
    this.emit('close', { code: 1000 })
    this.listeners.clear()
  }

  private async run(call: CuaCall): Promise<CuaToolResult> {
    const config = this.deps.config()

    if (!config)
      return failed(
        'Computer Use is not installed on this computer. It needs the ChatGPT/Codex App with Computer Use enabled.',
      )
    let host = hosts.get(call.session)

    if (!host) {
      host = this.deps.host(call.session, config)
      hosts.set(call.session, host)
    }
    host.elicit = (request) =>
      new Promise((resolve) => {
        if (this.readyState !== 1) {
          resolve(false)

          return
        }
        const id = randomUUID()

        this.replies.set(id, resolve)
        this.emit('message', { data: JSON.stringify({ t: 'elicit', id, ...request }) })
      })
    try {
      return await host.run(call, this.abort.signal)
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    } finally {
      host.elicit = undefined
    }
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

/** Tool streams a device tunnel serves; Computer Use only where the Codex App runs. */
export const localToolStreams = {
  connectExec: (): SocketLike => new LocalExecStream(),
  ...(process.platform === 'darwin' ? { connectCua: (): SocketLike => new LocalCuaStream() } : {}),
}
