// Suffix-window protocol for transcript-carrying requests (POST /agent/chat,
// PUT /agent/conversations/:id/transcript).
//
// The backend persists every finalized turn and accepts `baseIndex` + a tail,
// hydrating the stored prefix by count. So only the tail that can still be
// unsettled client-side is sent: from the user messages since the last
// assistant reply onward. That always contains the current turn (in-flight
// assistant message, client-tool results, permission decisions) and any
// earlier user message that never got a reply (a send that failed before the
// backend stored it), while everything before it was finalized or synced.
//
// The preload windows before ipcRenderer.invoke, so the whole tab transcript
// never crosses IPC into the main process: copying it into the main heap on
// every turn is what ran the main process out of memory. If the server
// disagrees (409 transcript_out_of_sync), callers rebase the same tail onto
// the stored count the rejection carries.

export type TranscriptWindow<M> = {
  messages: M[]
  /** Absolute index of `messages[0]`; 0 / undefined = full transcript. */
  baseIndex: number | undefined
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
  while (lastUser > 0 && messages[lastUser - 1]?.role === 'user') lastUser--
  if (lastUser <= 0) return { messages, baseIndex: base > 0 ? base : undefined }

  return {
    messages: messages.slice(lastUser),
    baseIndex: base + lastUser,
  }
}

/** IPC args with `messages` cut down to the current turn's tail. */
export function withTranscriptTail<A extends { messages: RoleCarrier[]; baseIndex?: number }>(
  args: A,
): A {
  return { ...args, ...windowTranscript(args.messages, args.baseIndex) }
}

/**
 * The server's stored message count carried in a 409 transcript_out_of_sync
 * error payload, when present. Lets the caller retry the same tail with the
 * server's count as `baseIndex`.
 */
export function storedMessageCountFromDetails(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null) return undefined
  const value = (details as { storedMessageCount?: unknown }).storedMessageCount

  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}
