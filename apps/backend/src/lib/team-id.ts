/**
 * Team ids are 24-hex ObjectIds. Callers that must tell "you can't have this
 * team" (403) apart from "that isn't a team id at all" (400) check the shape
 * here first — `resolveVerifiedTeamId` deliberately collapses both into
 * `undefined`, which is right for the filter-building callers and wrong for
 * choosing an error code.
 *
 * Its own module so the check is reachable without importing the agent routes,
 * which start background work (warm-pool replenish) on import.
 */
export function isTeamIdShape(candidate: string): boolean {
  return /^[a-f0-9]{24}$/i.test(candidate)
}
