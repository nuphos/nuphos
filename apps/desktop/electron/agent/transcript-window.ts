// Suffix-window protocol for transcript-carrying requests (POST /agent/chat,
// PUT /agent/conversations/:id/transcript).
//
// The renderer hands over the whole tab transcript every turn; sending all of
// it grows the body with every tool output until the ingress answers 413, long
// before model-side compaction would trip. The backend persists every finalized
// turn and accepts `baseIndex` + a tail, hydrating the stored prefix by count.
// So only the tail that can still be unsettled client-side goes over the wire:
// from the most recent user message onward. That always contains the current
// turn (in-flight assistant message, client-tool results, permission
// decisions), while everything before it was finalized or synced already.
// If the server disagrees (409 transcript_out_of_sync) callers resend the
// full transcript once.

export type TranscriptWindow<M> = {
  messages: M[]
  /** Absolute index of `messages[0]`; 0 / undefined = full transcript. */
  baseIndex: number | undefined
  /** Messages dropped from the head relative to the caller's input. */
  dropped: number
}

type RoleCarrier = { role?: unknown }

export function windowTranscript<M extends RoleCarrier>(
  messages: M[],
  baseIndex: number | undefined,
): TranscriptWindow<M> {
  const base = baseIndex && baseIndex > 0 ? Math.floor(baseIndex) : 0
  let lastUser = -1

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      lastUser = i
      break
    }
  }
  if (lastUser <= 0) return { messages, baseIndex: base > 0 ? base : undefined, dropped: 0 }

  return {
    messages: messages.slice(lastUser),
    baseIndex: base + lastUser,
    dropped: lastUser,
  }
}

/**
 * The server's stored message count carried in a 409 transcript_out_of_sync
 * error payload, when present. Lets the caller retry the same window with the
 * server's count as `baseIndex` instead of falling straight back to the full
 * transcript (which can exceed the ingress body limit on long sessions).
 */
export function storedMessageCountFromDetails(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null) return undefined
  const value = (details as { storedMessageCount?: unknown }).storedMessageCount

  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}
