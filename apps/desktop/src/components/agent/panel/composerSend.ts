// Whether a send took ownership of the draft: true once it is a message, a
// queued entry or an accepted dispatch; false when it was refused before any
// of that (no runtime, read-only tab, upload in progress…). Most sends answer
// at once; a first send on a just-started runtime answers once it is listed.
export type SendResult = Promise<boolean>

/**
 * Hands a draft to `send` and clears the composer only once the send owns it.
 * A refused send leaves the draft where it was. A late acceptance clears only
 * if the draft is still the one that was sent, so newer typing survives; and
 * while it is pending, `pending` holds further submits off so the same draft
 * cannot go out twice. Nothing is retried.
 */
export function submitDraft(
  send: () => SendResult,
  {
    pending,
    clear,
    unchanged,
  }: {
    pending: { current: boolean }
    clear: () => void
    /** Whether the composer still holds the draft that was sent. */
    unchanged: () => boolean
  },
): void {
  if (pending.current) return
  pending.current = true
  send()
    .then((accepted) => {
      if (accepted && unchanged()) clear()
    })
    .catch(() => {
      // The sender reports its own failures; the draft simply stays.
    })
    .finally(() => {
      pending.current = false
    })
}

/** Runs `accepted` or `refused` once `result` settles; a failed send counts as refused. */
export function settleSend(
  result: SendResult,
  { accepted, refused }: { accepted?: () => void; refused?: () => void },
): void {
  void result.then(
    (ok) => (ok ? accepted : refused)?.(),
    () => refused?.(),
  )
}
