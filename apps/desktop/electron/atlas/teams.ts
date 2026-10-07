import { call } from './client'

import type { AgentProvider } from '../../src/types/runtime'

/** Compatibility with older servers; never used to restrict access. */
export type TeamBillingSummary = { activated: boolean; active: boolean }

export type Team = {
  id: string
  name: string
  avatarUrl?: string
  ownerID?: string
  contactEmails?: string[]
  allowedEmailDomains?: string[]
  agentRuntime?: AgentProvider
  createdAt?: string
  isOwner?: boolean
  role?: TeamRole
  billing?: TeamBillingSummary
}

export type DiscoverableTeam = {
  id: string
  name: string
  avatarUrl?: string
  memberCount: number
  memberPreviews: { name: string; avatarURL: string }[]
}

export type BindingAccess = {
  memberAllowList: string[]
  updatedAt: string | null
  updatedBy: string | null
}

export type TeamRole = 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER'

export type TeamMember = {
  id: string
  email: string
  name: string
  username: string
  avatarURL?: string
  language?: string
  createdAt?: string
  role: TeamRole
  joinedAt: string
}

export type TeamInvitation = {
  id: string
  inviterId: string
  teamId: string
  team?: Pick<Team, 'id' | 'name' | 'avatarUrl'>
  invitedAt: string
  inviteeEmail: string
  acceptedAt?: string
  rejectedAt?: string
}

export type SidebarFavoriteEntry = { label: string; key?: string; href?: string }
export type SidebarFavoritesSnapshot = {
  entries: SidebarFavoriteEntry[]
  revision: number
  updatedAt: string | null
}

export async function listTeams(): Promise<Team[]> {
  // Team discovery is the desktop bootstrap gate. The shared development
  // Mongo replica can take well over the global 15s request budget while its
  // Tailscale path is relayed, so let the backend finish instead of leaving the
  // entire app on an opaque IPC timeout screen.
  const data = await call<{ teams: Team[] }>('GET', '/teams', undefined, { timeoutMs: 60_000 })

  return data.teams ?? []
}

export async function createTeam(name: string): Promise<Team> {
  const data = await call<{ team: Team }>('POST', '/teams', { name }, { retry: false })

  return data.team
}

export async function getSidebarFavorites(teamId: string): Promise<SidebarFavoritesSnapshot> {
  return call('GET', `/teams/${encodeURIComponent(teamId)}/favorites`)
}

export async function putSidebarFavorites(
  teamId: string,
  entries: SidebarFavoriteEntry[],
  expectedRevision: number,
): Promise<SidebarFavoritesSnapshot> {
  return call(
    'PUT',
    `/teams/${encodeURIComponent(teamId)}/favorites`,
    { entries, expectedRevision },
    { retry: false },
  )
}

export async function getHomeLayout(teamId: string): Promise<unknown> {
  return call('GET', `/teams/${encodeURIComponent(teamId)}/home-layout`)
}

/** `scope: 'team'` is the administrator-set default; a null layout removes it. */
export async function putHomeLayout(
  teamId: string,
  scope: 'personal' | 'team',
  layout: unknown,
): Promise<void> {
  await call(
    'PUT',
    `/teams/${encodeURIComponent(teamId)}/home-layout/${scope}`,
    { layout },
    { retry: false },
  )
}

export async function updateTeam(
  teamId: string,
  input: { name?: string; avatarUrl?: string },
): Promise<Team> {
  return call<Team>('PATCH', `/teams/${teamId}`, input, { retry: false })
}

// Enables/disables workspace discovery for the acting admin's own email
// domain; the backend derives the domain from the caller, never free-form.
export async function setTeamEmailDomainDiscovery(teamId: string, enabled: boolean): Promise<Team> {
  return call<Team>('PUT', `/teams/${teamId}/allowed-email-domains`, { enabled }, { retry: false })
}

export async function listDiscoverableTeams(): Promise<DiscoverableTeam[]> {
  const data = await call<{ teams: DiscoverableTeam[] }>('GET', '/teams/discoverable')

  return data.teams ?? []
}

export async function joinDiscoverableTeam(teamId: string): Promise<Team> {
  const data = await call<{ team: Team }>('POST', `/teams/discoverable/${teamId}/join`, undefined, {
    retry: false,
  })

  return data.team
}

export async function listTeamMembers(
  teamId: string,
  includeRemoved = false,
): Promise<TeamMember[]> {
  const path = includeRemoved
    ? `/teams/${teamId}/members?includeRemoved=true`
    : `/teams/${teamId}/members`
  const data = await call<{ members: TeamMember[] }>('GET', path)

  return data.members ?? []
}

export async function listTeamInvitations(teamId: string): Promise<TeamInvitation[]> {
  const data = await call<{ invitations: TeamInvitation[] }>('GET', `/teams/${teamId}/invitations`)

  return data.invitations ?? []
}

export async function cancelTeamInvitation(
  teamId: string,
  invitationId: string,
): Promise<TeamInvitation> {
  const data = await call<{ invitation: TeamInvitation }>(
    'DELETE',
    `/teams/${teamId}/invitations/${invitationId}`,
    undefined,
    { retry: false },
  )

  return data.invitation
}

export async function removeTeamMember(teamId: string, memberId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/members/${memberId}`, undefined, { retry: false })
}

// Disband the team (owner-only, enforced by the backend).
export async function deleteTeam(teamId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}`, undefined, { retry: false })
}

// Self-leave: the acting user removes their own membership.
export async function leaveTeam(teamId: string): Promise<void> {
  await call<void>('POST', `/teams/${teamId}/leave`, undefined, { retry: false })
}

export async function updateTeamMemberRole(
  teamId: string,
  memberId: string,
  role: TeamRole,
): Promise<TeamMember> {
  const data = await call<{ member: TeamMember }>(
    'PATCH',
    `/teams/${teamId}/members/${memberId}`,
    { role },
    { retry: false },
  )

  return data.member
}

export async function listMyInvitations(): Promise<TeamInvitation[]> {
  const data = await call<{ invitations: TeamInvitation[] }>('GET', '/invitations')

  return data.invitations ?? []
}

export async function inviteTeamMember(
  teamId: string,
  inviteeEmail: string,
): Promise<TeamInvitation> {
  const data = await call<{ invitation: TeamInvitation }>(
    'POST',
    `/teams/${teamId}/invitations`,
    { inviteeEmail },
    { retry: false },
  )

  return data.invitation
}

export async function acceptInvitation(invitationId: string): Promise<TeamInvitation> {
  const data = await call<{ invitation: TeamInvitation }>(
    'POST',
    `/invitations/${invitationId}/accept`,
    undefined,
    { retry: false },
  )

  return data.invitation
}

export async function rejectInvitation(invitationId: string): Promise<TeamInvitation> {
  const data = await call<{ invitation: TeamInvitation }>(
    'POST',
    `/invitations/${invitationId}/reject`,
    undefined,
    { retry: false },
  )

  return data.invitation
}
