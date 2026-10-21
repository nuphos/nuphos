import { tokenTeamFilter } from '@/lib/identity/token-team-scope'

// A resolved lookup scope. `number` is unique per team (team plans) or per
// user (personal plans), so every number lookup must carry the scope.
export type PlanScope = {
  teamId?: string
  userId: string
  /** Optional stricter boundary for conversation-scoped runtime credentials. */
  sourceConversationId?: string
}

// Strict scoped filter — no loose `$exists` fallback, so #2 in team A can
// never resolve to a same-numbered plan in another team / a personal plan.
export function scopedNumberFilter(planNumber: number, scope: PlanScope): Record<string, unknown> {
  const tokenTeam = tokenTeamFilter(scope.teamId)
  const owner =
    tokenTeam !== undefined
      ? { number: planNumber, teamId: tokenTeam }
      : scope.teamId
        ? { number: planNumber, teamId: scope.teamId }
        : { number: planNumber, createdBy: scope.userId }

  return scope.sourceConversationId
    ? { ...owner, sourceConversationId: scope.sourceConversationId }
    : owner
}

// The public id is the number string. Parse strictly: "6a14…" (a stray legacy
// ObjectId) must NOT be coerced to a number — reject anything non-integer.
export function parsePlanNumber(id: string): number | null {
  const n = Number(id)

  return Number.isInteger(n) && n > 0 ? n : null
}

// Team plans carry their teamId; plans without one are personal and are only
// ever listed for their creator (listPlans scopes those by createdBy).
export function withTeamScope(
  base: Record<string, unknown>,
  teamId: string | undefined,
): Record<string, unknown> {
  const tokenTeam = tokenTeamFilter(teamId)

  if (tokenTeam !== undefined) return { ...base, teamId: tokenTeam }

  return teamId ? { ...base, teamId } : base
}
