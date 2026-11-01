import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CUA_CLIENT, CUA_PLUGIN_CACHE } from './agent-home.ts'
import { BrowserAccessHost } from './cua-browser-access.ts'

/** What one `local_cua` call asks of this computer. */
export type CuaCall = {
  session: string
  turn: string
  code: string
  title?: string
  timeoutMs?: number
}

export type CuaElicitation = { message: string; meta: Record<string, unknown> }

export type CuaToolResult = { content: unknown[]; isError?: boolean }

export type ServerConfig = { command: string; args: string[]; env: Record<string, string> }

/** The App's REPL drops its bindings, cursor and approvals when idle this long. */
export const CUA_IDLE_MS = 60_000
/** How long the App may take to clean up its turn before its process is stopped. */
const TURN_END_MS = 2_000
const CANCELLED = 'The call was cancelled before it ran.'

export const failed = (text: string): CuaToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
})

function codexHome(env: NodeJS.ProcessEnv): string {
  return env.CODEX_HOME ?? path.join(env.HOME ?? os.homedir(), '.codex')
}

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

    return { command: server.command, args: server.args ?? [], env: server.env ?? {} }
  } catch {
    return null
  }
}

/**
 * One `cua_repl` process per conversation, so the agent's JavaScript bindings
 * survive between calls the way they do under local Codex. Calls run one at a
 * time. It holds no state beyond the process: idle, it ends the App's turn,
 * forgets its approvals and exits.
 */
export class CuaHost {
  private readonly process: ReturnType<typeof spawn>
  private readonly access: BrowserAccessHost
  private readonly pending = new Map<number, (message: Record<string, unknown>) => void>()
  private nextId = 1
  private buffer = ''
  private turn: string | undefined
  private idle: ReturnType<typeof setTimeout> | undefined
  private ready: Promise<unknown> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  /** Answers the App's approval prompts for the call in flight. */
  private elicit: ((request: CuaElicitation) => Promise<boolean>) | undefined
  /** Apps allowed "for this session", which the App leaves to its client to remember. */
  private readonly approved = new Set<string>()

  private readonly session: string
  private readonly onExit: () => void
  private readonly env: NodeJS.ProcessEnv

  constructor(
    session: string,
    config: ServerConfig,
    onExit: () => void,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.session = session
    this.onExit = onExit
    this.env = env
    this.access = new BrowserAccessHost(session, () => this.turn)
    this.process = spawn(config.command, config.args, {
      env: { ...env, ...config.env, ...this.access.env },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    this.process.stdout?.setEncoding('utf8').on('data', (chunk: string) => this.read(chunk))
    this.process.on('exit', () => this.exited())
    this.process.on('error', () => this.exited())
  }

  run(
    call: CuaCall,
    signal: AbortSignal,
    elicit: (request: CuaElicitation) => Promise<boolean>,
  ): Promise<CuaToolResult> {
    const result = this.queue.then(() => this.runNow(call, signal, elicit))

    this.queue = result.catch(() => {})

    return result
  }

  private async runNow(
    call: CuaCall,
    signal: AbortSignal,
    elicit: (request: CuaElicitation) => Promise<boolean>,
  ): Promise<CuaToolResult> {
    // A call whose stream closed while it was queued must never reach the App.
    if (signal.aborted) return failed(CANCELLED)
    this.ready ??= this.initialize()
    await this.ready
    if (signal.aborted) return failed(CANCELLED)
    clearTimeout(this.idle)
    this.elicit = elicit
    if (this.turn && this.turn !== call.turn) void this.endTurn()
    this.turn = call.turn
    const id = this.nextId
    const cancel = () =>
      this.write({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: id },
      })

    signal.addEventListener('abort', cancel, { once: true })
    try {
      const response = await this.request('tools/call', {
        name: 'js',
        arguments: {
          code: call.code,
          ...(call.title ? { title: call.title } : {}),
          ...(call.timeoutMs ? { timeout_ms: call.timeoutMs } : {}),
        },
        _meta: { 'x-codex-turn-metadata': { session_id: this.session, turn_id: call.turn } },
      })
      const error = response.error as { message?: string } | undefined

      return error
        ? failed(error.message ?? 'Computer Use failed')
        : (response.result as CuaToolResult)
    } finally {
      signal.removeEventListener('abort', cancel)
      this.elicit = undefined
      this.idle = setTimeout(() => void this.close(), CUA_IDLE_MS)
    }
  }

  async close(): Promise<void> {
    clearTimeout(this.idle)
    // New calls start a fresh host instead of reaching this dying one.
    this.onExit()
    await this.endTurn()
    this.process.kill()
  }

  /** Clears the App's cursor and per-turn state, as Codex's Stop hook and notify do. */
  private async endTurn(): Promise<void> {
    const turn = this.turn

    if (!turn) return
    this.turn = undefined
    const ended = this.request('tools/call', {
      name: 'turn_ended',
      arguments: { hook_event_name: 'Stop', session_id: this.session, turn_id: turn },
    }).catch(() => {})
    const client = path.join(codexHome(this.env), CUA_CLIENT)

    if (existsSync(client))
      execFile(
        client,
        [
          'turn-ended',
          JSON.stringify({
            type: 'agent-turn-complete',
            'thread-id': this.session,
            'turn-id': turn,
          }),
        ],
        { env: { ...this.env, CODEX_HOME: codexHome(this.env) } },
        () => {},
      )
    await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, TURN_END_MS))])
  }

  private initialize(): Promise<unknown> {
    return (
      this.access.listening
        .then(() =>
          this.request('initialize', {
            protocolVersion: '2025-06-18',
            capabilities: { elicitation: {} },
            clientInfo: { name: 'nuphos-desktop', version: '1' },
          }),
        )
        .then(() => this.write({ jsonrpc: '2.0', method: 'notifications/initialized' }))
        // A server that failed to start fails the call itself instead.
        .catch(() => {})
    )
  }

  private request(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = this.nextId++

    return new Promise((resolve, reject) => {
      if (this.process.exitCode !== null || this.process.killed) {
        reject(new Error('Computer Use exited'))

        return
      }
      this.pending.set(id, resolve)
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  private write(message: Record<string, unknown>): void {
    this.process.stdin?.write(`${JSON.stringify(message)}\n`)
  }

  private read(chunk: string): void {
    this.buffer += chunk
    let newline: number

    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)

      this.buffer = this.buffer.slice(newline + 1)
      let message: Record<string, unknown>

      try {
        message = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      // Server-initiated requests share the id space with ours; only `method` tells them apart.
      if (typeof message.method === 'string') {
        if (message.id !== undefined) void this.answer(message)
        continue
      }
      const resolve = this.pending.get(message.id as number)

      this.pending.delete(message.id as number)
      resolve?.(message)
    }
  }

  private async answer(message: Record<string, unknown>): Promise<void> {
    if (message.method !== 'elicitation/create') {
      this.write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `${String(message.method)} is not supported` },
      })

      return
    }
    const params = (message.params ?? {}) as { message?: string; _meta?: Record<string, unknown> }
    const meta = params._meta ?? {}
    const key = JSON.stringify([meta.connector_id, meta.tool_params ?? params.message])
    let accepted = this.approved.has(key)

    if (!accepted && this.elicit) {
      accepted = await this.elicit({ message: params.message ?? '', meta }).catch(() => false)
      if (accepted && Array.isArray(meta.persist) && meta.persist.includes('session'))
        this.approved.add(key)
    }
    this.write({
      jsonrpc: '2.0',
      id: message.id,
      result: accepted ? { action: 'accept', content: {} } : { action: 'decline' },
    })
  }

  private exited(): void {
    clearTimeout(this.idle)
    this.access.close()
    for (const resolve of this.pending.values())
      resolve({ error: { message: 'Computer Use exited' } })
    this.pending.clear()
    this.onExit()
  }
}
