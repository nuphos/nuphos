import type { AtlasTeam } from '../types'

/** OpenAB brings its own model access, so Agent no longer depends on a Nuphos plan. */
export function teamCanUseAgent(team: AtlasTeam | null | undefined): boolean {
  return Boolean(team)
}
