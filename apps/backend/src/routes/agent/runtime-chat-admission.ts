import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'

import { AppError } from '@/lib/errors'

/** Commands may be rejected by runtime; backend transport leases never grant admission. */
export function assertRuntimeChatAdmission(
  snapshot: SessionExecutionState | undefined,
  attached: boolean,
  replying: boolean,
): void {
  if (replying)
    throw new AppError(
      409,
      'runtime_request_ended',
      'The agent is no longer waiting for this response',
    )
  if (attached && snapshot?.schemaVersion !== 2)
    throw new AppError(503, 'runtime_status_unavailable', 'Cannot reach authoritative agent status')
  if (snapshot?.schemaVersion === 2 && !snapshot.actions?.send)
    throw new AppError(
      409,
      'runtime_not_accepting_message',
      snapshot.label ?? 'The agent cannot accept a message yet',
    )
}

/** Idle but briefly refusing sends (e.g. reading session settings), not mid-turn or awaiting the user. */
export function runtimeRefusalIsTransient(snapshot: SessionExecutionState | undefined): boolean {
  return (
    snapshot?.schemaVersion === 2 &&
    !snapshot.actions?.send &&
    snapshot.state !== 'active' &&
    !snapshot.requestPending &&
    !snapshot.requests?.length
  )
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Re-read a transiently refusing runtime before answering 409. The budget must
 * stay under the desktop's 5s first-byte deadline (CHAT_STREAM_FIRST_BYTE_TIMEOUT_MS).
 */
export async function settleRuntimeChatAdmission(
  initial: SessionExecutionState | undefined,
  read: () => Promise<SessionExecutionState>,
  options: { budgetMs?: number; retryMs?: number; maxRetryMs?: number } = {},
): Promise<SessionExecutionState | undefined> {
  const deadline = Date.now() + (options.budgetMs ?? 3_000)
  const maxRetryMs = options.maxRetryMs ?? 800
  let delay = options.retryMs ?? 100
  let snapshot = initial

  while (runtimeRefusalIsTransient(snapshot) && Date.now() + delay < deadline) {
    await wait(delay)
    snapshot = await read()
    delay = Math.min(delay * 2, maxRetryMs)
  }

  return snapshot
}

export async function admitRuntimeChat<C>(
  snapshot: SessionExecutionState | undefined,
  options: {
    attached: C | undefined
    replying: boolean
    read: (conversation: C) => Promise<SessionExecutionState>
    budgetMs?: number
    retryMs?: number
  },
): Promise<void> {
  const { attached, replying, read } = options
  const settled =
    attached && !replying
      ? await settleRuntimeChatAdmission(snapshot, () => read(attached), options)
      : snapshot

  assertRuntimeChatAdmission(settled, Boolean(attached), replying)
}
