// Runtime-status probe for the Settings > Agent card: what the backend knows
// about the Team's Claude Code runtime — registered runtimes, workspace
// selection, reachability, the sandbox's /statusz, and this process's
// connection state.

import { controlRegistry } from './agent-chat-registry'
import { previewRuntimeObservability } from './agent-chat-runtime'
import { reachableRuntimeEndpoint } from './dev-runtime-forward'
import { developmentRuntimeEndpoint } from './runtime-catalog'
import { pairedBindingRevoked } from './runtime-pairing'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'
import { fetchStatusz } from './runtime-statusz'
import { teamRuntimeSessions } from './runtime-team-sessions'

import type { OpenAbProvider } from './runtime-provider'
import type { OwnedSessionIds } from './runtime-team-sessions'

import { getTeamAgentRuntime } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

type RuntimeSessionSnapshot = {
  sessionId?: string
  state: string
  activityPhase?: { phase: string; phaseElapsedMs: number }
}

// A permission wait is expected to run long — a human decides on their own
// schedule — so it gets a looser threshold than every other phase, where
// silence this long means the runtime is stuck, not merely busy.
const STALL_FLAG_THRESHOLD_MS = 2 * 60 * 1000
const PERMISSION_WAIT_STALL_FLAG_THRESHOLD_MS = 10 * 60 * 1000

// A self-hosted runtime URL is operator-supplied and may embed userinfo or a
// token query param; keep only what identifies which runtime stalled.
export function sanitizeRuntimeUrl(url: string): string {
  try {
    const parsed = new URL(url)

    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return '[unparseable runtime url]'
  }
}

// Log-only for now: this is the earliest point Nuphos can see that a session
// has been silent too long, well before openab's own 600s/1800s watchdogs
// fire. A stuck 24-minute session ("Continuing after a background task…")
// would have shown up here within STALL_FLAG_THRESHOLD_MS of going quiet.
export function flagStalledSession(
  teamId: string,
  runtimeUrl: string,
  session: RuntimeSessionSnapshot,
): void {
  const activityPhase = session.activityPhase

  if (!activityPhase || activityPhase.phase === 'idle') return
  const threshold =
    activityPhase.phase === 'prompt_permission_wait' ||
    activityPhase.phase === 'agent_permission_wait'
      ? PERMISSION_WAIT_STALL_FLAG_THRESHOLD_MS
      : STALL_FLAG_THRESHOLD_MS

  if (activityPhase.phaseElapsedMs < threshold) return
  logEvent('warn', 'openab.runtime.session_stalled', {
    team_id: teamId,
    runtime_url: sanitizeRuntimeUrl(runtimeUrl),
    session_state: session.state,
    phase: activityPhase.phase,
    phase_elapsed_ms: activityPhase.phaseElapsedMs,
  })
}

/** This team's sessions in a runtime inventory, flagging the stalled ones; `null` when unattributable. */
export async function teamSessionsInInventory(
  teamId: string,
  runtimeUrl: string,
  sessions: RuntimeSessionSnapshot[],
  owned?: OwnedSessionIds,
): Promise<RuntimeSessionSnapshot[] | null> {
  const mine = await teamRuntimeSessions(teamId, sessions, owned)

  for (const session of mine ?? []) flagStalledSession(teamId, runtimeUrl, session)

  return mine
}

export type PreviewRuntimeStatus = {
  runtimeVersion?: string
  configured: boolean
  selected: boolean
  online?: boolean
  latencyMs?: number
  uptimeSeconds?: number
  agentProcesses?: number
  acpConnections?: number
  connected: boolean
  connectedAtMs?: number
  /** Build identity the runtime reported on initialize (version handshake). */
  runtimeBuildSha?: string
  runtimeAdapterVersion?: string
  attachedConversations: number | null
  busyConversations: number | null
  /**
   * Whether the runtime holds a provider credential of its own. Absent when it cannot
   * say — an older runtime, one that keeps no credential file, or one this process
   * could not reach. Absent is "unknown", never "signed out": a self-hosted container
   * may carry an account Nuphos cannot see.
   */
  authenticated?: boolean
  /** The runtime's owner revoked this team's pairing; only a new pairing code restores it. */
  credentialRevoked?: boolean
}

export async function claudeCodePreviewRuntimeStatus(
  teamId: string,
  _userId: string,
  provider: OpenAbProvider = 'claude-code',
  runtimeId?: string,
): Promise<PreviewRuntimeStatus> {
  const endpoints = await resolveTeamRuntimeEndpoints(teamId, undefined, provider)
  const development = developmentRuntimeEndpoint(provider)

  if (development && runtimeId === development.runtimeId) endpoints.push(development)
  const registered = runtimeId
    ? endpoints.filter((endpoint) => endpoint.runtimeId === runtimeId)
    : endpoints
  const observed = previewRuntimeObservability(
    teamId,
    provider,
    runtimeId ? registered.map((endpoint) => endpoint.url) : undefined,
  )
  const configured = registered.length > 0
  const selected = (await getTeamAgentRuntime(teamId)) === provider
  const controls = await resolveTeamRuntimeEndpoints(teamId, undefined, provider, 'control')

  if (development && runtimeId === development.runtimeId) {
    const control = developmentRuntimeEndpoint(provider, 'control')

    if (control) controls.push(control)
  }
  const snapshots = await Promise.allSettled(
    registered.map(async (endpoint) => {
      const control = controls.find((candidate) => candidate.url === endpoint.url)

      if (!control) throw new Error('Runtime operator credential is unavailable')
      const client = await controlRegistry.acquire(teamId, control)
      const inventory = await client.getRuntimeExecutionState()

      if (!Array.isArray(inventory.sessions)) throw new Error('Invalid runtime session inventory')

      return {
        sessions: await teamSessionsInInventory(
          teamId,
          endpoint.url,
          inventory.sessions as RuntimeSessionSnapshot[],
        ),
        authenticated: inventory.authenticated,
      }
    }),
  )
  const reached = snapshots.every((result) => result.status === 'fulfilled')
  const known = snapshots.every(
    (result) => result.status === 'fulfilled' && result.value.sessions !== null,
  )
  const sessions = snapshots.flatMap((result) =>
    result.status === 'fulfilled' ? (result.value.sessions ?? []) : [],
  )
  // Only a single runtime's status can answer this; a provider-wide roll-up would
  // report one runtime's account for another's.
  const authenticated =
    runtimeId && snapshots.length === 1 && snapshots[0]?.status === 'fulfilled'
      ? snapshots[0].value.authenticated
      : undefined
  const base: PreviewRuntimeStatus = {
    configured,
    selected,
    ...(observed.connectedAtMs === undefined
      ? { connected: false }
      : { connected: true, connectedAtMs: observed.connectedAtMs }),
    ...(observed.buildSha ? { runtimeBuildSha: observed.buildSha } : {}),
    ...(observed.adapterVersion ? { runtimeAdapterVersion: observed.adapterVersion } : {}),
    attachedConversations: known ? sessions.length : null,
    busyConversations: known
      ? sessions.filter((snapshot) => snapshot.state === 'active').length
      : null,
    ...(typeof authenticated === 'boolean' ? { authenticated } : {}),
    ...(runtimeId && !reached && (await pairedBindingRevoked(teamId, runtimeId))
      ? { credentialRevoked: true }
      : {}),
  }
  const probeTarget = registered[0]

  if (!probeTarget) return base
  const probe = await reachableRuntimeEndpoint(probeTarget)
    .catch(() => probeTarget)
    .then((reachable) => fetchStatusz(reachable.url))

  if (!probe) return { ...base, online: false }

  return { ...base, online: true, latencyMs: probe.latencyMs, ...probe.statusz }
}
