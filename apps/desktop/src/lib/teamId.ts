/**
 * Team ids are Mongo ObjectIds. A workspace tab scoped to anything else is
 * unreachable — the team picker can't name it (it renders as "?") and every
 * /teams/:teamId request 400s — so any team id that arrives as a caller-supplied
 * argument is checked here before a tab is built from it.
 */
export function isTeamId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)
}
