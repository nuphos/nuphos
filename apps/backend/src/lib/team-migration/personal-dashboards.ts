import { nuphosDashboards } from '@/models'

import type { ClientSession, ObjectId } from 'mongodb'

/** The team's personal dashboards, by id: their creators', so a team export leaves them out. */
export async function personalDashboardIds(teamId: ObjectId, session: ClientSession) {
  const ids = new Set<string>()
  const cursor = nuphosDashboards().find(
    { teamId, visibility: 'personal' },
    { session, projection: { _id: 1 } },
  )

  try {
    for await (const row of cursor) ids.add(row._id.toHexString())
  } finally {
    await cursor.close()
  }

  return ids
}
