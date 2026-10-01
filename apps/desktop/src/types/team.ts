export type UserInfo = {
  id: string
  name: string
  email: string
  username: string
  avatarURL?: string
  language?: string
  createdAt?: string
}

export type AuthStatus = { loggedIn: false } | { loggedIn: true; user: UserInfo; token: string }

export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'not-available' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

export type ChangelogEntry = {
  slug: string
  title: string
  summary: string
  date: string
  coverUrl: string
  url: string
}

export type ChangelogState = { kind: 'unavailable' } | { kind: 'ready'; entries: ChangelogEntry[] }

/** Compatibility with older servers; never used to restrict access. */
export type TeamBillingSummary = { activated: boolean; active: boolean }

export type AtlasTeam = {
  id: string
  name: string
  avatarUrl?: string
  ownerID?: string
  contactEmails?: string[]
  allowedEmailDomains?: string[]
  agentRuntime?: 'claude-code' | 'codex'
  createdAt?: string
  isOwner?: boolean
  role?: TeamRole
  billing?: TeamBillingSummary
}

export type RuntimeUpdateStatus = {
  state: 'unknown' | 'current' | 'available' | 'waiting' | 'updating' | 'failed'
  currentVersion?: string
  latestVersion?: string
  targetVersion?: string
  releaseUrl: string
  error?: string
}

export type OpenAbRuntimeStatus = {
  runtimeVersion?: string
  runtimeUpdate?: RuntimeUpdateStatus
  configured: boolean
  selected: boolean
  online?: boolean
  latencyMs?: number
  uptimeSeconds?: number
  agentProcesses?: number
  acpConnections?: number
  connected: boolean
  connectedAtMs?: number
  attachedConversations: number | null
  busyConversations: number | null
  /** Whether the runtime holds a provider credential of its own. Absent means it
   *  cannot say — never that it is signed out. */
  authenticated?: boolean
  /** The agent's owner revoked this team's pairing; only a new pairing code restores it. */
  credentialRevoked?: boolean
}

export type DiscoverableTeam = {
  id: string
  name: string
  avatarUrl?: string
  memberCount: number
  memberPreviews: { name: string; avatarURL: string }[]
}

export type TeamRole = 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER'

export type TeamMember = UserInfo & {
  role: TeamRole
  joinedAt: string
  /** ISO time this member was removed from the team; present only for members
   *  fetched with `includeRemoved`. Absent for active members. */
  removedAt?: string
}

export type TeamInvitation = {
  id: string
  inviterId: string
  teamId: string
  team?: Pick<AtlasTeam, 'id' | 'name' | 'avatarUrl'>
  invitedAt: string
  inviteeEmail: string
  acceptedAt?: string
  rejectedAt?: string
}

export type SidebarFavoriteCloudEntry = { label: string; key?: string; href?: string }
export type SidebarFavoritesCloudSnapshot = {
  entries: SidebarFavoriteCloudEntry[]
  revision: number
  updatedAt: string | null
}
