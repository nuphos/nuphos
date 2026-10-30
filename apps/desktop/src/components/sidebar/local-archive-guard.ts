/**
 * Chats archived from this sidebar, each mapped to the refresh sequence number
 * current when its PATCH landed. Listings from that sequence or earlier may
 * predate the archive and still carry the row; a later one is authoritative,
 * so the guard lets go and a since-restored chat can list again.
 */
export type LocalArchiveGuard = Map<string, number>

export const ARCHIVE_IN_FLIGHT = Number.POSITIVE_INFINITY

export function visibleSidebarChats<T extends { sessionId: string; archivedAt?: string }>(
  rows: readonly T[],
  guard: LocalArchiveGuard,
  requestSeq: number,
): T[] {
  for (const [sessionId, settledSeq] of guard) {
    if (requestSeq > settledSeq) guard.delete(sessionId)
  }

  return rows.filter((row) => !row.archivedAt && !guard.has(row.sessionId))
}

/**
 * Chats restored from this sidebar, each with its row and the refresh sequence
 * number current when the restore landed. A listing from that sequence or
 * earlier may predate the restore and lack the row, so the row is put back in
 * activity order; a later listing is authoritative and releases the guard.
 */
export type LocalRestoreGuard<T> = Map<string, { row: T; settledSeq: number }>

export function withRestoredChats<T extends { sessionId: string; lastActiveAt: string }>(
  rows: readonly T[],
  guard: LocalRestoreGuard<T>,
  requestSeq: number,
): T[] {
  const result = [...rows]

  for (const [sessionId, { row, settledSeq }] of guard) {
    if (requestSeq > settledSeq) {
      guard.delete(sessionId)
      continue
    }
    if (result.some((listed) => listed.sessionId === sessionId)) continue
    const index = result.findIndex((listed) => listed.lastActiveAt < row.lastActiveAt)

    result.splice(index === -1 ? result.length : index, 0, row)
  }

  return result
}
