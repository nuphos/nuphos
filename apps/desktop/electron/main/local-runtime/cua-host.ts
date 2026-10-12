import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CUA_CLIENT, CUA_PLUGIN_CACHE } from './agent-home.ts'

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

/** Apps the user allowed for a conversation, outliving its idle `cua_repl` process. */
const sessionApprovals = new Map<string, Set<string>>()

/** The App's REPL drops its bindings and the cursor when idle this long. */
export const CUA_IDLE_MS = 60_000

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
 * survive between calls the way they do under local Codex. It holds no state
 * beyond the process: idle, it ends the App's turn and exits.
 */
export class CuaHost {
  private readonly process: ReturnType<typeof spawn>
  private readonly pending = new Map<number, (message: Record<string, unknown>) => void>()
  private nextId = 1
  private buffer = ''
  private turn: string | undefined
  private idle: ReturnType<typeof setTimeout> | undefined
  private ready: Promise<unknown> | undefined
  /** Answers the App's approval prompts for the call in flight. */
  elicit: ((request: CuaElicitation) => Promise<boolean>) | undefined

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
    this.process = spawn(config.command, config.args, {
      env: { ...env, ...config.env },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    this.process.stdout?.setEncoding('utf8').on('data', (chunk: string) => this.read(chunk))
    this.process.on('exit', () => this.exited())
    this.process.on('error', () => this.exited())
  }

  async run(call: CuaCall, signal: AbortSignal): Promise<CuaToolResult> {
    clearTimeout(this.idle)
    this.ready ??= this.initialize()
    await this.ready
    if (this.turn && this.turn !== call.turn) this.endTurn()
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
      this.idle = setTimeout(() => this.close(), CUA_IDLE_MS)
    }
  }

  close(): void {
    clearTimeout(this.idle)
    this.endTurn()
    this.process.kill()
  }

  /** Clears the App's cursor and per-turn state, as Codex's Stop hook and notify do. */
  private endTurn(): void {
    const turn = this.turn

    if (!turn) return
    this.turn = undefined
    void this.request('tools/call', {
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
  }

  private initialize(): Promise<unknown> {
    return (
      this.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: { elicitation: {} },
        clientInfo: { name: 'nuphos-desktop', version: '1' },
      })
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
    const params = (message.params ?? {}) as { message?: string; _meta?: Record<string, unknown> }
    const meta = params._meta ?? {}
    // The App leaves "for this session" to its client, as Codex does: once per app and conversation.
    const key = JSON.stringify([meta.connector_id, meta.tool_params ?? params.message])
    const approved = sessionApprovals.get(this.session) ?? new Set<string>()
    let accepted = approved.has(key)

    if (!accepted && message.method === 'elicitation/create' && this.elicit) {
      accepted = await this.elicit({ message: params.message ?? '', meta }).catch(() => false)
      if (accepted && Array.isArray(meta.persist) && meta.persist.includes('session')) {
        approved.add(key)
        sessionApprovals.set(this.session, approved)
      }
    }
    this.write({
      jsonrpc: '2.0',
      id: message.id,
      result: accepted ? { action: 'accept', content: {} } : { action: 'decline' },
    })
  }

  private exited(): void {
    clearTimeout(this.idle)
    for (const resolve of this.pending.values())
      resolve({ error: { message: 'Computer Use exited' } })
    this.pending.clear()
    this.onExit()
  }
}
