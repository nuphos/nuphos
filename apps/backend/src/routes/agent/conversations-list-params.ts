import { AppError } from '@/lib/errors'

import type { ConversationsArchivedFilter, ConversationsSort } from '@/lib/agent/db'

const SORTS: readonly ConversationsSort[] = ['activity', 'created', 'archived']

export function parseArchivedParam(
  raw: string | undefined,
): ConversationsArchivedFilter | undefined {
  if (raw == null) return undefined
  if (raw !== 'exclude' && raw !== 'only') {
    throw new AppError(400, 'invalid_request', "archived must be 'exclude' or 'only'")
  }

  return raw
}

/** Sorting by archive time lists the archive, so it cannot also exclude it. */
export function parseSortParam(
  raw: string | undefined,
  archived: ConversationsArchivedFilter | undefined,
): ConversationsSort | undefined {
  if (raw == null) return undefined
  const sort = SORTS.find((candidate) => candidate === raw)

  if (!sort) {
    throw new AppError(400, 'invalid_request', "sort must be 'activity', 'created' or 'archived'")
  }
  if (sort === 'archived' && archived === 'exclude') {
    throw new AppError(400, 'invalid_request', "sort 'archived' lists archived chats only")
  }

  return sort
}
