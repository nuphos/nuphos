import type { AgentProvider } from './runtime.ts'

export type UserInfo = {
  id: string
  name: string
  email: string
  username: string
  avatarURL?: string
  language?: string
  createdAt?: string
}

export type SocialProvider = 'google' | 'apple'

export type AuthStatus = { loggedIn: false } | { loggedIn: true; user: UserInfo; token: string }

/** One of the account's sign-ins, as GET /auth/sessions lists it. */
export type SignInSession = {
  id: string
  current: boolean
  createdAt: string
  lastUsedAt: string
  expiresAt: string
  ip: string | null
  city: string | null
  country: string | null
  /** The app's own name and version, e.g. `nuphos-desktop/1.2.0`. */
  client: string | null
  userAgent: string | null
}

export type PersonalCredentialProvider = 'github' | 'linear' | 'gmail' | 'google-drive'

export type PersonalCredential = {
  provider: PersonalCredentialProvider
  login: string
  workspaceName: string | null
  /** Gmail / Google Drive: the team whose OAuth client issued the grant. */
  teamId?: string | null
  connectedAt: string
}

/** Outcome of a nuphos://personal-credential deep link, claimed by the main process. */
export type PersonalCredentialDeepLinkPayload = {
  provider: PersonalCredentialProvider
  login?: string
  error?: string
}

export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | {
      kind: 'downloading'
      version: string
      transferred: number
      total: number
      bytesPerSecond: number
    }
  | { kind: 'ready'; version: string }
  | { kind: 'error' }

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
  agentRuntime?: AgentProvider
  /** The most a member may grant when sharing their own computer; absent from older backends. */
  localAgentSharing?: 'off' | 'approve' | 'full'
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
  /** When a sign-in that lapses on its own (a one-year token) does; absent for one that refreshes. */
  credentialExpiresAt?: string
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

/** A repository a home card follows, addressed the way the GitHub API routes need it. */
export type HomeRepo = { installationId: number; fullName: string }

export type HomePullStatus = 'open' | 'ready' | 'draft'
export type HomeRunStatus = 'failed' | 'running' | 'latest'

/** A pull request or CI card: the repositories it follows and what it shows of them. */
export type HomeGithubCard =
  | { id: string; kind: 'pulls'; repos: HomeRepo[]; statuses: HomePullStatus[] }
  | { id: string; kind: 'ci'; repos: HomeRepo[]; statuses: HomeRunStatus[] }

/** A Nuphos Dashboards panel pinned to the home page. */
export type HomePanel = { dashboardId: string; panelId: string }

/**
 * What the home page shows: the team activity card, the repositories each
 * GitHub card follows (a card with none is hidden) and the dashboard panels
 * pinned as cards of their own.
 */
export type HomeLayout = {
  team: boolean
  /** Pull request and CI cards; there can be any number of each. */
  github: HomeGithubCard[]
  panels: HomePanel[]
  /** Metric cards, each with its own range and scope. */
  metrics?: HomeMetricCard[]
  /** Where each card sits, in grid units; a card without an entry goes last. */
  grid?: HomeGridItem[]
  /** Set once card sizes are fitted to their content; see fitOldSizes. */
  gridVersion?: number
}

/** A card's place on the home grid: `i` is the card's key, the rest grid units. */
export type HomeGridItem = { i: string; x: number; y: number; w: number; h: number }

/** The caller's own layout and the team default; either is null when unset. */
export type HomeLayouts = { personal: HomeLayout | null; team: HomeLayout | null }

/** The agents the caller's conversations move to, in order, when theirs runs out or breaks. */
export type RuntimeFallback = { runtimeIds: string[] }

export type TeamActivityRange = '1d' | '7d' | '30d'

/** `me` counts the viewer's own sessions, `team` everyone's. */
export type AgentStatsScope = 'me' | 'team'

/** The viewer's IANA time zone goes along, so days and hours are local to them. */
export type AgentStatsQuery = { range: TeamActivityRange; scope: AgentStatsScope; timeZone: string }

/** A session a card may name and open; null when it is not the viewer's to see. */
export type AgentStatsSession = { id: string; title: string } | null

export type AgentStatTotals = {
  /** Summed turn time; sessions running side by side add up. */
  agentMs: number
  turns: number
  /** Sessions started, sub-agents not included. */
  sessions: number
  subAgents: number
  /** Pull requests linked to a session. */
  prsOpened: number
  prsMerged: number
  /** Merged between midnight and 7 in the viewer's time zone. */
  prsMergedOvernight: number
}

/** What the home metric cards show for one range and scope. */
export type AgentStats = {
  range: TeamActivityRange
  scope: AgentStatsScope
  timeZone: string
  current: AgentStatTotals
  /** The same totals for the period of the same length just before. */
  previous: AgentStatTotals
  streak: { current: number; best: number; lookbackDays: number }
  longest: { ms: number; startedAt: string; session: AgentStatsSession } | null
  /** The session that started the most sub-agents. */
  fanOut: { count: number; session: AgentStatsSession } | null
  /** The most turns running at once. */
  peak: { count: number; at: string } | null
  runtimes: { runtime: AgentProvider | null; agentMs: number }[]
  /** Only the most recently active sessions were read, so the numbers may be low. */
  capped: boolean
}

export type HomeMetricKind =
  'agent-time' | 'sessions' | 'pull-requests' | 'streak' | 'longest-run' | 'runtime-mix'

/** A metric card on the home page, with its own range and scope. */
export type HomeMetricCard = {
  id: string
  kind: HomeMetricKind
  range: TeamActivityRange
  scope: AgentStatsScope
}

/** Who ran which sessions in each slot of a range, oldest slot first. */
export type TeamActivity = {
  range: TeamActivityRange
  slotMinutes: number
  start: string
  sessions: { id: string; title: string; runtime: AgentProvider | null }[]
  /** Every current member, busiest first. */
  members: {
    id: string
    name: string
    avatarURL: string
    /** Per slot, the member's sessions running in it, as indexes into `sessions`. */
    slots: number[][]
  }[]
}
