import { AppError } from '@/lib/errors'
import { isTeamIdShape } from '@/lib/team-id'

// A Watch group asks for every partition trigger at once, and a group is
// bounded by its providers — far below this. The cap exists so a client can't
// turn the listing into an unbounded `$in`.
const MAX_TRIGGER_IDS = 100

/**
 * The `triggerId` query parameter of `GET /agent/conversations`, as a list.
 *
 * Absent means Chats, which excludes trigger runs entirely; present means one
 * trigger's (or one Watch group's) run history. Because those two are opposite
 * listings, a malformed value must fail rather than degrade — falling back to
 * "absent" would answer a Runs request with the whole team's chat history.
 */
export function parseTriggerIdsParam(raw: string | undefined): string[] | undefined {
  if (raw == null) return undefined
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  if (ids.length > MAX_TRIGGER_IDS) {
    throw new AppError(
      400,
      'invalid_request',
      `triggerId accepts at most ${String(MAX_TRIGGER_IDS)} ids`,
    )
  }
  // Trigger ids share the team id's 24-hex ObjectId shape.
  if (ids.some((id) => !isTeamIdShape(id))) {
    throw new AppError(400, 'invalid_request', 'triggerId must be a valid trigger id')
  }

  return ids
}
