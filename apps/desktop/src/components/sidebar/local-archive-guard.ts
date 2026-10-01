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
