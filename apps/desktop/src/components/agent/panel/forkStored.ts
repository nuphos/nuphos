// Each fork's first send: its history import, if it had history, and its first turn.
const forkSends = new Map<string, { imported: Promise<void> | null; turn: Promise<unknown> }>()

export function rememberForkSend(
  tabId: string,
  imported: Promise<void> | null,
  turn: Promise<unknown>,
) {
  forkSends.set(tabId, { imported, turn })
}

/**
 * Settles once the server stores the fork `tabId` sent its first message in:
 * when its copied history is imported, or, with no history to import, when
 * that first turn has run, even if the turn failed. Rejects when the import
 * fails, since the server then has no fork.
 */
export async function forkStored(tabId: string): Promise<void> {
  const send = forkSends.get(tabId)

  forkSends.delete(tabId)
  if (!send) return
  await (send.imported ?? send.turn.catch(() => undefined))
}
