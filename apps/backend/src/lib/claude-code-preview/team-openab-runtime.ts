import { logEvent } from '@/lib/observability'

import {
  runtimeBuildInfo,
  runtimeJobs,
  supportsPermissionRelay,
  supportsRuntimeAuthority,
} from './openab-acp-session'

import type { AcpHttpMcpServer, OpenAbAcpClient } from './openab-acp-client'
import type { OpenAbSessionRuntime } from './openab-acp-session'
import type { OpenAbProvider } from './runtime-provider'

type RuntimeBuildInfo = ReturnType<typeof runtimeBuildInfo>

export type TeamPreviewClient = Pick<
  OpenAbAcpClient,
  | 'initialize'
  | 'getSessionExecutionState'
  | 'sessionRequests'
  | 'getRuntimeExecutionState'
  | 'runtimeLogin'
  | 'cancelRuntimeLogin'
  | 'runtimeLoginInput'
  | 'onRuntimeLoginFrame'
  | 'createSession'
  | 'loadSession'
  | 'prompt'
  | 'cancel'
  | 'close'
  | 'onClosed'
  | 'onRetired'
  | 'onSessionUpdate'
  | 'onSessionPermission'
>

export type TeamRuntimeEndpoint = {
  runtimeId?: string
  provider?: OpenAbProvider
  url: string
  authKey: string
  /** Runs outside this cluster, so anything it is handed must be publicly reachable. */
  external?: boolean
  /** Where the runtime reaches this backend, when its host reported it. */
  backendUrl?: string
  /** The owner's own computer, reached through its tunnel; `authKey` then names the purpose. */
  local?: { userId: string; deviceId: string }
}

export type TeamSession = {
  teamId: string
  conversationId: string
  /** Latest execution principal; MCP credentials and approvals are scoped here. */
  userId: string
  /** Durable conversation owner; owner-scoped checks must use this, not the actor. */
  conversationOwnerUserId?: string
  locale: string
  openabSessionId: string
  client: TeamPreviewClient
  /** The runtime this conversation was placed on; later turns stay on it. */
  endpoint: TeamRuntimeEndpoint
  /** Latest MCP declaration; re-presented on session/load after a reconnect. */
  mcpServers: AcpHttpMcpServer[]
  /** Nuphos context appended to Claude Code's system prompt; re-presented on load. */
  systemPrompt?: string
  /** Session-scoped environment and native skill files passed through ACP. */
  runtime?: OpenAbSessionRuntime
  /** When session/new or session/resume last handed the runtime this context. */
  contextDeliveredAt?: number
  /** Transcript subscription only; never used for session admission or UI. */
  autonomousTranscriptOpen?: boolean
  /** Runtime-reported lifecycle; tool traffic must never override it. */
  runtimeThreadStatus?: string
  runtimeProjectionObserved?: boolean
  /** ACP async-task id → the existing command card it belongs to. */
  asyncTaskToolCalls?: Map<string, string>
  stopObserving?: () => void
  /**
   * A resume outside a turn found the inner agent gone. Consumed by the next
   * prompt so the loss is reported instead of dying with the old process.
   */
  innerSessionLost?: boolean
  /** The lost transport a background re-attach is currently replacing. */
  reattaching?: TeamPreviewClient
  activeTurn?: { cancelled: boolean; client?: TeamPreviewClient }
}

const SAFE_CONVERSATION_ID = /^[A-Za-z0-9_-]+$/

// ponytail: per-conversation subdir; Claude Code walks up to /workspace for .claude/
export function previewRuntimeCwd(conversationId: string): string {
  if (!SAFE_CONVERSATION_ID.test(conversationId)) {
    throw new Error('Conversation id contains invalid characters.')
  }

  return `/workspace/conv-${conversationId}`
}

export const MAX_PREVIEW_CONVERSATION_ID_LENGTH = 200
export const MAX_TEAM_PREVIEW_CONVERSATIONS = 100

/** The runtime answered but lacks a capability this backend requires. */
export class RuntimeCapabilityError extends Error {
  override name = 'RuntimeCapabilityError'
}

const teamRuntimeKey = (teamId: string, endpoint: TeamRuntimeEndpoint) =>
  `${teamId}|${endpoint.url}`

export function cancelActiveTeamTurn(session: TeamSession) {
  const turn = session.activeTurn

  if (!turn) return
  turn.cancelled = true
  if (turn.client) turn.client.cancel(session.openabSessionId)
}

export function createTeamRuntimeRegistry<Client extends TeamPreviewClient>(
  connect: (endpoint: TeamRuntimeEndpoint) => Promise<Client>,
) {
  const runtimes = new Map<string, Promise<Client>>()
  const connectedAt = new Map<string, number>()
  const buildInfoByKey = new Map<string, RuntimeBuildInfo>()
  const jobsByKey = new Map<string, string[]>()

  // One shared connection per (team, runtime endpoint) — a team may run on
  // several runtimes, each with its own transport.
  const acquire = (teamId: string, endpoint: TeamRuntimeEndpoint) => {
    const key = teamRuntimeKey(teamId, endpoint)
    const existing = runtimes.get(key)

    if (existing) return existing

    const connecting = connect(endpoint)
      .then(async (client) => {
        const buildInfo = await (async (): Promise<RuntimeBuildInfo> => {
          try {
            const initialized = await client.initialize()

            if (!supportsPermissionRelay(initialized)) {
              throw new RuntimeCapabilityError(
                'The OpenAB runtime does not support permission relay.',
              )
            }

            if (!supportsRuntimeAuthority(initialized)) {
              throw new RuntimeCapabilityError(
                'Update this agent before starting a chat: authoritative session state is unavailable.',
              )
            }

            jobsByKey.set(key, runtimeJobs(initialized))

            return runtimeBuildInfo(initialized)
          } catch (error) {
            client.close()
            throw error
          }
        })()

        // Version handshake (drift audit D1/D4): record what the deployed
        // runtime says it was built from, so image/source drift is an
        // observable fact instead of a silent gap.
        buildInfoByKey.set(key, buildInfo)
        logEvent('info', 'agent.openab_runtime.connected', {
          team_id: teamId,
          runtime_url: endpoint.url,
          build_sha: buildInfo.buildSha ?? null,
          adapter_version: buildInfo.adapterVersion ?? null,
        })
        connectedAt.set(key, Date.now())
        const evict = () => {
          if (runtimes.get(key) === connecting) {
            runtimes.delete(key)
            connectedAt.delete(key)
            buildInfoByKey.delete(key)
            jobsByKey.delete(key)
          }
        }

        client.onClosed(evict)
        client.onRetired(evict)

        return client
      })
      .catch((error: unknown) => {
        if (runtimes.get(key) === connecting) runtimes.delete(key)
        throw error
      })

    runtimes.set(key, connecting)

    return connecting
  }

  /** Connection observability for the runtime-status endpoint. */
  const connectionInfo = (
    teamId: string,
    runtimeUrls?: string[],
  ): { connected: boolean; connectedAtMs?: number } & RuntimeBuildInfo => {
    const prefix = `${teamId}|`
    let earliest: number | undefined
    let earliestKey: string | undefined

    for (const [key, at] of connectedAt) {
      if (
        !key.startsWith(prefix) ||
        (runtimeUrls && !runtimeUrls.includes(key.slice(prefix.length)))
      )
        continue
      if (earliest === undefined || at < earliest) {
        earliest = at
        earliestKey = key
      }
    }

    return earliest === undefined
      ? { connected: false }
      : {
          connected: true,
          connectedAtMs: earliest,
          ...(earliestKey ? buildInfoByKey.get(earliestKey) : {}),
        }
  }

  /** Named jobs the connected runtime advertised on initialize. */
  const runtimeJobsOf = (teamId: string, endpoint: TeamRuntimeEndpoint): readonly string[] =>
    jobsByKey.get(teamRuntimeKey(teamId, endpoint)) ?? []

  return { acquire, connectionInfo, runtimeJobs: runtimeJobsOf }
}
