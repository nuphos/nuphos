import { randomUUID } from 'node:crypto'

import { CuaHost, cuaServerConfig, failed } from './cua-host.ts'
import { LocalExecStream } from './exec-stream.ts'

import type { CuaCall, CuaElicitation, CuaToolResult, ServerConfig } from './cua-host.ts'
import type { SocketEvent, SocketLike } from './tunnel-client.ts'

type Listener = (event: SocketEvent) => void

const hosts = new Map<string, CuaHost>()

/** Below the tunnel's 8 MiB frame payload, leaving room for its JSON escaping. */
export const CUA_RESULT_MAX_CHARS = 6 * 1024 * 1024

/** A result too large for one frame keeps its text and explains the dropped images. */
export function fitFrame(result: CuaToolResult): CuaToolResult {
  if (JSON.stringify(result).length <= CUA_RESULT_MAX_CHARS) return result
  const text = result.content.filter((part) => (part as { type?: string }).type !== 'image')
  const images = result.content.length - text.length
  const megabytes = (JSON.stringify(result).length / 1024 / 1024).toFixed(1)

  if (JSON.stringify(text).length > CUA_RESULT_MAX_CHARS)
    return failed('The result was too large to send. Read a smaller part of the UI.')

  return {
    ...result,
    content: [
      ...text,
      {
        type: 'text',
        text: `${images} screenshot(s) totalling ${megabytes} MB were too large to send in one result and were dropped. Take fewer screenshots per call.`,
      },
    ],
  }
}

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
      host: (session: string, config: ServerConfig): CuaHost => {
        const host: CuaHost = new CuaHost(session, config, () => {
          if (hosts.get(session) === host) hosts.delete(session)
        })

        return host
      },
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
      this.emit('message', { data: JSON.stringify({ t: 'result', result: fitFrame(result) }) })
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
    const elicit = (request: CuaElicitation) =>
      new Promise<boolean>((resolve) => {
        if (this.readyState !== 1) {
          resolve(false)

          return
        }
        const id = randomUUID()

        this.replies.set(id, resolve)
        this.emit('message', { data: JSON.stringify({ t: 'elicit', id, ...request }) })
      })

    try {
      return await host.run(call, this.abort.signal, elicit)
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
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
