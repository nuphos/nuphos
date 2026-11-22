import { ObjectId } from 'mongodb'

/**
 * A conversation page ends at its last row's sort time and _id, which together
 * order every row: rows that share the time (an auto-archive batch, an archived
 * tree) continue on the next page instead of falling between the two. A cursor
 * of the time alone, from a client released before this, still pages as before.
 */
type Cursor = { time: Date; id?: ObjectId }

export function encodeCursor(time: Date, id: ObjectId): string {
  return `${time.toISOString()}_${id.toHexString()}`
}

export function decodeCursor(cursor: string): Cursor {
  const [time = '', id] = cursor.split('_')

  return { time: new Date(time), ...(id && ObjectId.isValid(id) ? { id: new ObjectId(id) } : {}) }
}

/** The rows after the cursor in the listing's (time, _id) order. */
export function after(filter: Record<string, unknown>, field: string, cursor: Cursor) {
  const bound = filter[field] as Record<string, unknown> | undefined

  if (!cursor.id) return { ...filter, [field]: { ...bound, $lt: cursor.time } }

  return {
    ...filter,
    [field]: { ...bound, $lte: cursor.time },
    $and: [
      ...((filter.$and as unknown[] | undefined) ?? []),
      { $or: [{ [field]: { $lt: cursor.time } }, { _id: { $lt: cursor.id } }] },
    ],
  }
}
