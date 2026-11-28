import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { CUA_PLUGIN_CACHE } from './agent-home.ts'
import { CuaHost, codexHome, failed } from './cua-host.ts'

import type { CuaCall, CuaElicitation, CuaToolResult, ServerConfig } from './cua-host.ts'
import type { SocketEvent, SocketLike } from './tunnel-client.ts'

type Listener = (event: SocketEvent) => void

const hosts = new Map<string, CuaHost>()

/** Computer Use only answers a `cua_repl` whose parent is a trusted OpenAI process (#3838). */
const UNDER_CODEX = [
  'sandbox',
  '-c',
  'sandbox_mode="danger-full-access"',
  '-c',
  'shell_environment_policy.inherit="all"',
  '--',
]

/** The newest `cua_repl` server the Codex App installed, or null without the App. */
export function cuaServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig | null {
  const root = path.join(codexHome(env), CUA_PLUGIN_CACHE)

  try {
    const [version] = readdirSync(root).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    )
    const manifest = JSON.parse(readFileSync(path.join(root, version, '.mcp.json'), 'utf8')) as {
      mcpServers?: { cua_repl?: Partial<ServerConfig> & { enabled?: boolean } }
    }
    const server = manifest.mcpServers?.cua_repl

    if (!server?.command || server.enabled === false || !existsSync(server.command)) return null
    const vars = server.env ?? {}
    const args = server.args ?? []
    const codex = vars.CODEX_CLI_PATH

    return codex && existsSync(codex)
      ? { command: codex, args: [...UNDER_CODEX, server.command, ...args], env: vars }
      : { command: server.command, args, env: vars }
  } catch {
    return null
  }
}

/** Below the tunnel's 8 MiB frame payload, leaving room for its JSON escaping. */
export const CUA_RESULT_MAX_CHARS = 6 * 1024 * 1024

/** A result too large for one frame keeps its text and explains the dropped images. */
export function fitFrame(result: CuaToolResult): CuaToolResult {
  const size = JSON.stringify(result).length

  if (size <= CUA_RESULT_MAX_CHARS) return result
  const text = result.content.filter((part) => (part as { type?: string }).type !== 'image')
  const images = result.content.length - text.length

  if (JSON.stringify(text).length > CUA_RESULT_MAX_CHARS)
    return failed('The result was too large to send. Read a smaller part of the UI.')

  return {
    ...result,
    content: [
      ...text,
      {
        type: 'text',
        text: `The result was ${(size / 1024 / 1024).toFixed(1)} MB, too large to send, so its ${images} screenshot(s) were dropped. Take fewer screenshots per call, or capture a single window or a smaller region.`,
      },
    ],
  }
}

/** A built-in Computer Use action: `{ action: 'click', x, y }` and the like (mac-screen-host.swift). */
export type CuaAction = Record<string, unknown>

/** Runs one action through the bundle's mac-screen-host, which reads it from stdin with `-`. */
export function nativeCua(binary: string, ownPermissions = false) {
  return (action: CuaAction, signal: AbortSignal): Promise<CuaToolResult> =>
    new Promise((resolve) => {
      const args = ownPermissions ? ['-', '--own-permissions'] : ['-']
      const child = execFile(
        binary,
        args,
        { signal, timeout: 60_000, maxBuffer: 2 * CUA_RESULT_MAX_CHARS },
        (error, stdout, stderr) => {
          try {
            resolve(JSON.parse(stdout) as CuaToolResult)
          } catch {
            const reason = stderr.replace(/^mac-screen-host: /mu, '').trim()

            resolve(failed(reason || error?.message || 'Computer Use failed'))
          }
        },
      )

      child.stdin?.on('error', () => {})
      child.stdin?.end(`${JSON.stringify(action)}\n`)
    })
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
    /** Built-in actions; only where this Mac's screen host ships. */
    native?: (action: CuaAction, signal: AbortSignal) => Promise<CuaToolResult>
  }

  constructor(deps: Partial<LocalCuaStream['deps']> = {}) {
    this.deps = {
      config: () => cuaServerConfig(),
      host: (session, config) => {
        const host: CuaHost = new CuaHost(session, config, () => {
          if (hosts.get(session) === host) hosts.delete(session)
        })

        return host
      },
      ...deps,
    }
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
    if (call.action)
      return this.deps.native
        ? this.deps.native(call.action, this.abort.signal)
        : failed('Built-in Computer Use needs Nuphos on macOS.')
    const config = this.deps.config()

    if (!config)
      return failed(
        'The Codex App’s Computer Use is not installed on this computer, so `code` cannot run. Use `action` instead.',
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
