import { inspect } from 'node:util'

export const RUN_STREAM_MAXLEN = 50_000
export const RUN_KEY_TTL_SEC = 2 * 60 * 60 // Long-running agent tasks should be attachable for at least an hour.
export const OWNER_TTL_SEC = 15
export const OWNER_HEARTBEAT_MS = 5_000
export const CANCELLATION_REQUEST_TTL_SEC = OWNER_TTL_SEC * 2
// Failsafe TTL for the session busy-guard keys (`agentrun-active` hash +
// `:reservation`). These are refreshed by the ownership heartbeat every
// OWNER_HEARTBEAT_MS while a run is live, so this TTL only ever fires when a run
// dies without releasing — a crash, a lost replica, or a Slack transport that
// fails after the model turn; a `chat.startStream` returning `user_not_found`
// has left the lock set this way. Bounding it to a small heartbeat multiple
// lets a stuck session self-heal in ~90s instead of inheriting the 2h
// stream-buffer TTL and blocking the user behind "busy rn" for hours.
export const ACTIVE_RUN_TTL_SEC = 90
// The reservation is a second lease held by the request handler that won the
// session claim. It is refreshed while that handler is alive, independently of
// the active-run ownership hash, so an asynchronous/missed initial ownership
// heartbeat cannot open an overlap window during a long ACP turn. It keeps this
// short TTL: a crashed handler still self-heals in 15s instead of stranding the
// session for the active hash's full failsafe window.
export const RESERVATION_TTL_SEC = 15
// A busy-guard hash whose per-stream owner lease is gone belongs to a replica
// that died without completing its release — SIGKILL, OOM, node eviction, or a
// graceful exit that outran its fire-and-forget DEL. Mirrors the resume path's
// failover grace (OWNER_TTL_SEC + 5): the lease is rewritten every
// OWNER_HEARTBEAT_MS, so tolerate a few missed beats before declaring the guard
// abandoned rather than briefly-stalled.
export const ABANDONED_GUARD_GRACE_MS = (OWNER_TTL_SEC + 5) * 1_000
export const TAIL_BLOCK_MS = 5_000
// Matches SSE_HEARTBEAT_INTERVAL_MS in routes/agent.ts: resume attaches were
// observed being cut by an intermediary ~10s idle timeout between 15s
// heartbeats while the model stream was silent (Braintrust).
export const SSE_HEARTBEAT_INTERVAL_MS = 5_000
export const RESUME_ATTACH_GRACE_MS = 30_000
export const RESUME_ATTACH_RETRY_MS = 500
// A resume from frame 0 whose run has neither a Redis stream nor an owner
// lease was almost certainly never registered anywhere — the original POST
// died in transit. The full attach grace only helps live replica handoffs, so
// once this many consecutive successful probes confirm the absence, fail fast
// and let the client fresh-start instead of pinning its UI on "Connecting…"
// for the whole window. Probe failures (Redis flaps) never count.
export const RESUME_ATTACH_ORPHAN_PROBES = 6

export function streamKey(userId: string, streamId: string): string {
  return `atlas:agentrun:${userId}:${streamId}`
}
export function ownerKey(userId: string, streamId: string): string {
  return `${streamKey(userId, streamId)}:owner`
}
export function cancellationKey(userId: string, streamId: string): string {
  return `${streamKey(userId, streamId)}:cancel`
}
export function activeRunKey(userId: string, sessionId: string): string {
  return `atlas:agentrun-active:${userId}:${sessionId}`
}
export function activeRunReservationKey(userId: string, sessionId: string): string {
  return `${activeRunKey(userId, sessionId)}:reservation`
}

export type ParsedEntry = { id: string; frame: string }

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function parseEntries(raw: unknown): ParsedEntry[] {
  if (!Array.isArray(raw)) return []
  const out: ParsedEntry[] = []

  for (const item of raw as unknown[]) {
    if (!Array.isArray(item) || item.length < 2) continue
    const [id, fields] = item as [string, string[]]

    if (typeof id !== 'string' || !Array.isArray(fields)) continue
    // fields is a flat [k, v, k, v, ...] array.
    for (let i = 0; i < fields.length - 1; i += 2) {
      if (fields[i] === 'f' && typeof fields[i + 1] === 'string') {
        out.push({ id, frame: fields[i + 1]! })
        break
      }
    }
  }

  return out
}

/** Marker used by the agent route to detect end-of-stream while tailing
 *  another replica's run. Must match AGENT_STREAM_DONE_EVENT in agent.ts. */
export const STREAM_DONE_NEEDLE = 'atlas-stream-done'

export function frameType(frame: string): string | undefined {
  if (frame.startsWith(':')) return 'comment'
  if (!frame.startsWith('data: ')) return undefined
  try {
    const payload = JSON.parse(frame.slice('data: '.length).trimEnd()) as { type?: unknown }

    return typeof payload.type === 'string' ? payload.type : undefined
  } catch {
    return 'malformed'
  }
}

export function cancelReason(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`
  if (typeof reason === 'string') return reason
  if (reason == null) return 'unknown'
  try {
    return JSON.stringify(reason)
  } catch {
    return inspect(reason, { depth: 3 })
  }
}
