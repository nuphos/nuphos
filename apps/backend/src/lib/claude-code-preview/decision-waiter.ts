// Blocking requests and decisions live in OpenAB. Redis contains only the
// ref-to-runtime routing index, never a pending/done flag or decision payload.
import { randomUUID } from 'node:crypto'

import { runtimeRequestStore } from './runtime-request-store'

import { withRedis } from '@/lib/redis'

export type PreviewWaitKind =
  'permission-grant' | 'authorization-rule' | 'client-tool' | 'agent-permission'

export type PreviewWait = {
  waitId: string
  userId: string
  sessionId: string
  kind: PreviewWaitKind
  /** Entity the decision is about (proposalId, ruleId, tool name). */
  ref?: string
  /** A client tool's full call, so the desktop can run it from the runtime snapshot alone. */
  clientTool?: PreviewClientToolCall
  createdAt: number
}

export type PreviewClientToolCall = {
  toolName: string
  input?: unknown
  /** Stream of the run that made the call; only the client that started it may run the tool. */
  streamId?: string
}

export type PreviewDecision = {
  payload: Record<string, unknown>
  /** Copied from the wait at resolution, since the wait record is deleted then. */
  kind?: PreviewWaitKind
  /** Stream the desktop opened to watch the continuation, when it opened one. */
  streamId?: string
  resolvedAt: number
}

type WaitAddress = Pick<PreviewWait, 'userId' | 'sessionId' | 'waitId'>
const localRoutes = new Map<string, WaitAddress>()
const refKey = (kind: PreviewWaitKind, ref: string) => `openab:request-route:${kind}:${ref}`

export async function registerPreviewWait(args: {
  userId: string
  sessionId: string
  kind: PreviewWaitKind
  ref?: string
  waitId?: string
  clientTool?: PreviewClientToolCall
}): Promise<PreviewWait> {
  let wait: PreviewWait = { ...args, waitId: args.waitId ?? randomUUID(), createdAt: Date.now() }
  const registered = await runtimeRequestStore(args.sessionId, {
    operation: 'register',
    userId: args.userId,
    waitId: wait.waitId,
    wait,
  })

  wait = registered.wait as PreviewWait
  if (wait.ref) {
    const address: WaitAddress = {
      userId: wait.userId,
      sessionId: wait.sessionId,
      waitId: wait.waitId,
    }
    const key = refKey(wait.kind, wait.ref)

    localRoutes.set(key, address)
    await withRedis((redis) => redis.set(key, JSON.stringify(address), 'EX', 6 * 60 * 60))
  }

  return wait
}

async function readRequest(
  address: WaitAddress,
): Promise<{ wait: PreviewWait | null; decision: PreviewDecision | null }> {
  return (await runtimeRequestStore(address.sessionId, {
    operation: 'read',
    userId: address.userId,
    waitId: address.waitId,
  })) as { wait: PreviewWait | null; decision: PreviewDecision | null }
}

export async function findPreviewWaitByRef(
  kind: PreviewWaitKind,
  ref: string,
): Promise<PreviewWait | null> {
  const key = refKey(kind, ref)
  const raw = await withRedis((redis) => redis.get(key))
  const address = raw ? (JSON.parse(raw) as WaitAddress) : localRoutes.get(key)

  if (!address) return null
  const current = await readRequest(address)

  return current.decision ? null : current.wait
}

export async function listPendingPreviewWaits(
  userId: string,
  sessionId: string,
): Promise<PreviewWait[]> {
  const result = await runtimeRequestStore(sessionId, { operation: 'list', userId })

  return (result.waits as PreviewWait[]).sort((a, b) => a.createdAt - b.createdAt)
}

export async function resolvePreviewDecision(args: {
  userId: string
  sessionId: string
  waitId: string
  payload: Record<string, unknown>
  streamId?: string
}): Promise<boolean> {
  const result = await runtimeRequestStore(args.sessionId, {
    operation: 'resolve',
    userId: args.userId,
    waitId: args.waitId,
    decision: { payload: args.payload, ...(args.streamId ? { streamId: args.streamId } : {}) },
  })

  return result.resolved === true
}

export async function resolvePreviewDecisionByRef(args: {
  kind: PreviewWaitKind
  ref: string
  payload: Record<string, unknown>
}): Promise<boolean> {
  const wait = await findPreviewWaitByRef(args.kind, args.ref)

  return wait
    ? resolvePreviewDecision({
        userId: wait.userId,
        sessionId: wait.sessionId,
        waitId: wait.waitId,
        payload: args.payload,
      })
    : false
}

/** Drop a wait nobody will answer, so the runtime stops listing it as pending. */
export async function expirePreviewWait(args: WaitAddress): Promise<void> {
  await runtimeRequestStore(args.sessionId, {
    operation: 'expire',
    userId: args.userId,
    waitId: args.waitId,
  })
}

/**
 * Resolve every pending wait of the given kinds as rejected. A wait outlives
 * neither the turn it parked nor the user's attention: whatever ends one — a
 * new message, a cancel — ends the other.
 */
export async function abandonPendingPreviewWaits(args: {
  userId: string
  sessionId: string
  kinds?: PreviewWaitKind[]
  reason: string
  supersededByUserId?: string
}): Promise<number> {
  const waits = (await listPendingPreviewWaits(args.userId, args.sessionId)).filter(
    (wait) => !args.kinds || args.kinds.includes(wait.kind),
  )
  let abandoned = 0

  for (const wait of waits) {
    const resolved = await resolvePreviewDecision({
      userId: wait.userId,
      sessionId: wait.sessionId,
      waitId: wait.waitId,
      payload: {
        decision: 'rejected',
        reason: args.reason,
        ...(args.supersededByUserId ? { supersededByUserId: args.supersededByUserId } : {}),
      },
    })

    if (resolved) abandoned++
  }

  return abandoned
}

export async function supersedePendingAgentPermissions(args: {
  userId: string
  sessionId: string
  supersededByUserId?: string
}): Promise<number> {
  return abandonPendingPreviewWaits({
    ...args,
    kinds: ['agent-permission'],
    reason: 'superseded_by_user_message',
  })
}

export async function awaitPreviewDecision(args: {
  userId: string
  sessionId: string
  waitId: string
  timeoutMs?: number
  pollMs?: number
  keepOnTimeout?: boolean
  signal?: AbortSignal
}): Promise<
  | { timedOut: false; decision: PreviewDecision }
  | { timedOut: true; reason: 'timeout' | 'vanished' | 'aborted' }
> {
  const deadline = Date.now() + (args.timeoutMs ?? 30 * 60_000)

  for (;;) {
    const current = await readRequest(args)

    // Checked after the read: a stop wins over any decision that raced it.
    if (args.signal?.aborted) {
      await expirePreviewWait(args).catch(() => undefined)

      return { timedOut: true, reason: 'aborted' }
    }
    if (current.decision) return { timedOut: false, decision: current.decision }
    // A restarted runtime has no native request to answer. Never resurrect it
    // from a backend cache or submit the old decision into a new process.
    if (!current.wait) return { timedOut: true, reason: 'vanished' }
    if (Date.now() >= deadline) {
      if (!args.keepOnTimeout) await expirePreviewWait(args)

      return { timedOut: true, reason: 'timeout' }
    }
    await new Promise((resolve) => setTimeout(resolve, args.pollMs ?? 500))
  }
}

export async function takePreviewDecision(
  userId: string,
  sessionId: string,
  waitId: string,
): Promise<PreviewDecision | null> {
  return (await readRequest({ userId, sessionId, waitId })).decision
}

/** Reset routing metadata only. This cannot clear or change runtime state. */
export function resetLocalPreviewWaits(): void {
  localRoutes.clear()
}
