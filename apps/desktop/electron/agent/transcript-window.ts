// Suffix-window protocol for POST /agent/chat and PUT .../transcript.
//
// The backend persists every finalized turn and accepts `baseIndex` + a tail,
// hydrating the stored prefix by count, so only the still-unsettled tail is
// sent: from the latest user message onward (the current turn's in-flight
// assistant message, client-tool results, permission decisions). /chat accepts
// exactly one new user message, as the final one, so the tail carries exactly
// one — an earlier user message whose send failed before the backend stored it
// is NOT resent, or /chat would reject two unstored user messages
// (invalid_message_batch). That failed send leaves the client's baseIndex
// ahead of the store; the 409 transcript_out_of_sync -> rebase path realigns it.
//
// The preload windows before ipcRenderer.invoke, so the whole transcript never
// crosses into the main heap every turn (that ran the main process out of memory).

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
