// Wire-level types for the OpenAB ACP client and the session-creation
// options it forwards to the runtime's inner claude-agent-acp session.
import type { PreviewAgentUpdate } from './preview-agent-update'
import type { RuntimeDefaults } from './runtime-defaults'
import type { OpenAbProvider } from './runtime-provider'

export const ACP_INITIALIZE_PARAMS = {
  protocolVersion: 1,
  clientCapabilities: { _meta: { 'dev.openab/sessionSnapshots': true } },
  clientInfo: { name: 'nuphos', version: 'poc' },
}

export type PendingCall = {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  /** Re-arms this call's timer; `progress` also restarts its progress window. */
  arm: (progress?: boolean) => ReturnType<typeof setTimeout>
  sessionId?: string
  onTextDelta?: (text: string) => void
  onAgentUpdate?: (update: PreviewAgentUpdate) => void
  onPermissionRequest?: OpenAbPermissionHandler
  onAccepted?: () => void
  accepted?: boolean
}

type SocketEvent = {
  data?: unknown
  code?: number
  message?: string
  reason?: string
}

export type AcpSocket = {
  readonly readyState: number
  readonly protocol?: string
  addEventListener(type: string, listener: (event: SocketEvent) => void): void
  removeEventListener(type: string, listener: (event: SocketEvent) => void): void
  send(data: string): void
  close(): void
}

export type SocketFactory = (url: string, protocols: string[]) => AcpSocket

// ACP-shape HTTP MCP server declaration, forwarded verbatim to the runtime's
// inner claude-agent-acp session (headers as {name, value} pairs, not a map).
export type AcpHttpMcpServer = {
  name: string
  type: 'http'
  url: string
  headers: { name: string; value: string }[]
}

export type OpenAbAcpClientOptions = {
  url: string
  authKey: string
  socketFactory?: SocketFactory
  connectTimeoutMs?: number
  callTimeoutMs?: number
  /** Inactivity window for one prompt; re-armed by session/update traffic. */
  promptTimeoutMs?: number
  /** Longest a prompt may go without turn progress; heartbeats do not count. */
  promptProgressTimeoutMs?: number
  retireGraceMs?: number
}

export type OpenAbSessionRuntime = {
  defaults?: RuntimeDefaults
  provider?: OpenAbProvider
  env?: Record<string, string>
}

export type OpenAbPermissionOption = {
  optionId: string
  name: string
  kind: string
}

export type OpenAbPermissionRequest = {
  sessionId: string
  toolCall: {
    toolCallId: string
    title: string
    rawInput?: unknown
  }
  options: OpenAbPermissionOption[]
}

export type OpenAbPermissionOutcome = {
  outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' }
}

export type OpenAbPermissionHandler = (
  request: OpenAbPermissionRequest,
) => Promise<OpenAbPermissionOutcome>

export function supportsPermissionRelay(initializeResult: unknown): boolean {
  if (!initializeResult || typeof initializeResult !== 'object') return false
  const capabilities = (initializeResult as Record<string, unknown>).agentCapabilities

  if (!capabilities || typeof capabilities !== 'object') return false
  const meta = (capabilities as Record<string, unknown>)._meta

  return (
    Boolean(meta) &&
    typeof meta === 'object' &&
    (meta as Record<string, unknown>)['dev.openab/permissionRelay'] === true
  )
}

export function supportsRuntimeAuthority(initializeResult: Record<string, unknown>): boolean {
  const capabilities = initializeResult.agentCapabilities as
    { _meta?: Record<string, unknown> } | undefined

  return capabilities?._meta?.['dev.openab/sessionAuthority'] === 2
}

const REFRESHED_CREDENTIALS = ['NUPHOS_TOKEN', 'NUPHOS_PLAN_API_TOKEN'] as const

// OpenAB rewrites these as per-session files on every prompt, so a live agent
// reads the current value instead of the one its process env was spawned with.
function runtimeCredentials(env: Record<string, string> | undefined) {
  const entries = REFRESHED_CREDENTIALS.flatMap((key): [string, string][] =>
    env?.[key] ? [[key, env[key]]] : [],
  )

  return entries.length > 0 ? { 'dev.openab/credentials': Object.fromEntries(entries) } : {}
}

// claude-agent-acp reads `_meta.systemPrompt` on session/new and session/load:
// the object form is merged onto the `claude_code` preset, so `append` adds
// Nuphos's context without replacing Claude Code's own system prompt.
function claudeCodeOptions(runtime: OpenAbSessionRuntime | undefined): {
  claudeCode?: { options: Record<string, unknown> }
} {
  return runtime?.env ? { claudeCode: { options: { env: runtime.env } } } : {}
}

export function sessionMeta(
  systemPrompt: string | undefined,
  runtime: OpenAbSessionRuntime | undefined,
): Record<string, unknown> {
  if (runtime?.provider === 'codex') {
    return {
      _meta: {
        'dev.openab/permissionPolicy': 'relay',
        'ai.nuphos/runtimeAuthority': 2,
        ...runtimeCredentials(runtime.env),
        ...(runtime.defaults ? { 'ai.nuphos/runtimeDefaults': runtime.defaults } : {}),
        'ai.nuphos/codex': {
          ...(systemPrompt ? { developerInstructions: systemPrompt } : {}),
          ...(runtime.env ? { env: runtime.env } : {}),
        },
      },
    }
  }
  // Grok Build and Antigravity run behind the runtime's ACP shim, which turns this
  // one shape into whatever each agent accepts (apps/runtime/image/acp-shim.mjs).
  if (runtime?.provider === 'grok' || runtime?.provider === 'antigravity') {
    return {
      _meta: {
        'dev.openab/permissionPolicy': 'relay',
        'ai.nuphos/runtimeAuthority': 2,
        ...runtimeCredentials(runtime.env),
        ...(runtime.defaults ? { 'ai.nuphos/runtimeDefaults': runtime.defaults } : {}),
        'ai.nuphos/session': {
          ...(systemPrompt ? { systemPrompt } : {}),
          ...(runtime.env ? { env: runtime.env } : {}),
        },
      },
    }
  }
  const meta = {
    'dev.openab/permissionPolicy': 'relay',
    'ai.nuphos/runtimeAuthority': 2,
    ...runtimeCredentials(runtime?.env),
    ...(runtime?.defaults ? { 'ai.nuphos/runtimeDefaults': runtime.defaults } : {}),
    ...(systemPrompt ? { systemPrompt: { append: systemPrompt } } : {}),
    ...claudeCodeOptions(runtime),
  }

  return { _meta: meta }
}

export type PromptSessionContext = {
  mcpServers: AcpHttpMcpServer[]
  systemPrompt?: string
  runtime?: OpenAbSessionRuntime
}

// Re-presents the turn's session context on every prompt. OpenAB stores it for
// respawns and refreshes the live agent's credential files from it.
export function promptMeta(
  acknowledge: boolean,
  context: PromptSessionContext | undefined,
): Record<string, unknown> {
  const meta = {
    ...(acknowledge ? { 'ai.nuphos/acknowledgePrompt': true } : {}),
    ...(context
      ? {
          'dev.openab/sessionMeta': sessionMeta(context.systemPrompt, context.runtime)._meta,
          'dev.openab/mcpServers': context.mcpServers,
        }
      : {}),
  }

  return Object.keys(meta).length > 0 ? { _meta: meta } : {}
}

/**
 * Reads the pool-liveness flag a newer gateway reports on `session/resume`.
 * Gateway-side resume is bookkeeping and succeeds even when the pool has
 * evicted the inner agent session; when the field is absent (older gateway),
 * assume alive so behavior is unchanged.
 */
export function resumeSessionAlive(result: Record<string, unknown>): boolean {
  const meta = result._meta

  if (!meta || typeof meta !== 'object') return true

  return (meta as Record<string, unknown>)['dev.openab/sessionAlive'] !== false
}

/**
 * Build identity a stamped runtime reports on `initialize`
 * (`dev.openab/buildSha`, `dev.openab/adapterVersion`). Local/dev runtimes
 * omit the keys; absent values stay undefined so callers log only facts.
 */
export function runtimeBuildInfo(initializeResult: unknown): {
  buildSha?: string
  adapterVersion?: string
} {
  if (!initializeResult || typeof initializeResult !== 'object') return {}
  const capabilities = (initializeResult as Record<string, unknown>).agentCapabilities

  if (!capabilities || typeof capabilities !== 'object') return {}
  const meta = (capabilities as Record<string, unknown>)._meta

  if (!meta || typeof meta !== 'object') return {}
  const record = meta as Record<string, unknown>
  const buildSha = record['dev.openab/buildSha']
  const adapterVersion = record['dev.openab/adapterVersion']

  return {
    ...(typeof buildSha === 'string' && buildSha ? { buildSha } : {}),
    ...(typeof adapterVersion === 'string' && adapterVersion ? { adapterVersion } : {}),
  }
}

export function runtimeJobs(initializeResult: unknown): string[] {
  if (!initializeResult || typeof initializeResult !== 'object') return []
  const capabilities = (initializeResult as Record<string, unknown>).agentCapabilities

  if (!capabilities || typeof capabilities !== 'object') return []
  const meta = (capabilities as Record<string, unknown>)._meta

  if (!meta || typeof meta !== 'object') return []
  const jobs = (meta as Record<string, unknown>)['dev.openab/runtimeJobs']

  return Array.isArray(jobs) ? jobs.filter((job): job is string => typeof job === 'string') : []
}

/** Runtime acknowledgement selects the output owner among concurrent commands. */
export function acceptRuntimePrompt(pendingCalls: Map<number, PendingCall>, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const params = raw as { requestId?: number; sessionId?: string }
  const pending = params.requestId === undefined ? undefined : pendingCalls.get(params.requestId)

  if (pending?.sessionId === params.sessionId && pending?.accepted === false) {
    pending.accepted = true
    pending.onAccepted?.()
  }
}

export type PendingCallContext = Pick<
  PendingCall,
  'sessionId' | 'onTextDelta' | 'onAgentUpdate' | 'onPermissionRequest' | 'onAccepted' | 'accepted'
>
