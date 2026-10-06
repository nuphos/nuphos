import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'

export type NuphosUser = {
  id: string
  email: string
  name: string
  username: string
  avatarURL: string
  language: string
  createdAt: string
}

export type NuphosTeamRole = 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER'

export type NuphosTeam = {
  id: string
  name: string
  avatarUrl: string
  ownerID: string | null
  contactEmails: string[]
  allowedEmailDomains: string[]
  agentRuntime: OpenAbProvider
  createdAt: string
  role?: NuphosTeamRole
  billing: TeamBillingSummary
}

export type TeamUpdateInput = {
  name?: string
  avatarUrl?: string
}

export type TeamMembership = {
  role: NuphosTeamRole
  team: NuphosTeam
}

export type NuphosTeamMember = NuphosUser & {
  role: NuphosTeamRole
  joinedAt: string
  // Set only for members surfaced via `includeRemoved` — the ISO time the
  // member was removed (soft-deleted) from the team. Absent for active members.
  removedAt?: string
}

export type AuthenticatedIdentity = {
  user: NuphosUser
  cacheHit: boolean
  provider: 'nuphos'
}

/** Compatibility summary for older clients. Access is always free. */
export type TeamBillingSummary = { activated: boolean; active: boolean }
export type TeamBilling = Record<string, unknown>
