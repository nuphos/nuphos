import type { TeamSkillManifest, TeamSkillSummary } from '../../api'
import type { TeamRole } from '../../types'

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; manifest: TeamSkillManifest }
  | { kind: 'error'; message: string; unconfigured?: boolean }

export type MenuState = {
  skill: TeamSkillSummary
  x: number
  y: number
}

export function canEditSkills(role: TeamRole | undefined): boolean {
  return role === 'ADMINISTRATOR' || role === 'EDITOR'
}

export function canDeleteSkills(role: TeamRole | undefined): boolean {
  return role === 'ADMINISTRATOR'
}
