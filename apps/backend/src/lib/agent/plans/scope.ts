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
  const owner = scope.teamId
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

// Team-scoped filter — mirrors the agent conversation pattern so plans
// written before this code shipped without a teamId still surface for the
// team. Personal (no-teamId) reads see only their own plans.
export function withTeamScope(
  base: Record<string, unknown>,
  teamId: string | undefined,
): Record<string, unknown> {
  if (!teamId) return base

  return { ...base, $or: [{ teamId }, { teamId: { $exists: false } }] }
}
