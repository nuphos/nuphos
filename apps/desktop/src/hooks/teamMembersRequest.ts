import type { TeamMember } from '../types/team'

/** One read of a team's members serves every view asking within this long. */
const MEMBERS_TTL_MS = 60_000

type Entry = { at: number; members: Promise<TeamMember[] | null> }

const shared = new Map<string, Entry>()

/**
 * A team's members, read once per team and shared by everyone asking. Keyed by team, so an
 * answer for one team never stands in for another; a failed read is dropped and asked again.
 */
export function teamMembersRequest(
  teamId: string,
  read: (teamId: string) => Promise<TeamMember[]>,
  now = Date.now(),
  cache: Map<string, Entry> = shared,
): Promise<TeamMember[] | null> {
  const cached = cache.get(teamId)

  if (cached && now - cached.at < MEMBERS_TTL_MS) return cached.members
  const entry: Entry = {
    at: now,
    members: read(teamId).catch(() => {
      if (cache.get(teamId) === entry) cache.delete(teamId)

      return null
    }),
  }

  cache.set(teamId, entry)

  return entry.members
}
