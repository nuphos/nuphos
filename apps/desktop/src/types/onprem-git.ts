export type OnpremCluster = {
  id: string
  label: string
  /** null until a credential is supplied — enrolment is deliberately tunnel-first. */
  endpoint: string | null
  hasCredential: boolean
  contextName: string
  createdAt?: string
  tokenIssuedAt?: string
  tokenExpiresAt?: string
}

/** Shown once, at enrolment or rotation — the backend keeps no copy. */
export type OnpremClusterInstall = {
  agentEndpoint: string
  token: string
  manifest: string
}

export type OnpremClusterConnection = {
  /** null when the relay itself could not be reached, which is our problem. */
  connected: boolean | null
  idleConnections: number | null
  lastSeenAt?: string | null
  agentVersion?: string | null
  reason?: string
}

export type OnpremClusterAccess = {
  reachable: boolean
  unreachableReason?: string
  serverVersion?: string
  identity?: { username: string; groups: string[] }
  namespaces?: { denied: true } | { denied: false; count: number; sample: string[] }
  permissions?: {
    namespace: string
    summary: string[]
    /** null when Kubernetes said the evaluation was incomplete — not "read-only". */
    canWrite: boolean | null
    incompleteReason?: string
  }
}

export type GrafanaInstance = {
  id: string
  name: string
  grafanaUrl: string
  createdAt?: string
}

export type GithubInstallation = {
  id: string
  installationId: number
  accountLogin: string
  accountType: 'User' | 'Organization'
  accountId: number
  targetType: 'all' | 'selected'
  createdAt?: string
}

export type GithubRepository = {
  id: number
  name: string
  fullName: string
  private: boolean
  htmlUrl: string
  description: string | null
  defaultBranch: string | null
  archived: boolean
  visibility: string | null
  pushedAt: string | null
}

export type GithubPR = {
  number: number
  title: string
  state: 'open' | 'closed'
  draft: boolean
  author: string
  authorAvatarUrl: string
  labels: { name: string; color: string }[]
  createdAt: string
  updatedAt: string
  htmlUrl: string
  headRef: string
  baseRef: string
}

export type GithubWorkflowRun = {
  id: number
  name: string
  status: string
  conclusion: string | null
  event: string
  headBranch: string
  headSha: string
  createdAt: string
  updatedAt: string
  htmlUrl: string
}

export type GitlabBinding = {
  id: string
  hostUrl: string
  accountId: number
  username: string
  displayName: string | null
  avatarUrl: string | null
  clientId: string
  isDefaultClient: boolean
  scope: string
  accessTokenExpiresAt: string | null
  createdAt?: string
}

export type GitlabProject = {
  id: number
  name: string
  pathWithNamespace: string
  description: string | null
  defaultBranch: string | null
  visibility: 'private' | 'internal' | 'public'
  webUrl: string
  archived: boolean
  lastActivityAt: string | null
}

export type GitlabMergeRequest = {
  iid: number
  title: string
  state: 'opened' | 'closed' | 'merged' | 'locked'
  draft: boolean
  author: string | null
  authorAvatarUrl: string | null
  labels: string[]
  createdAt: string
  updatedAt: string
  webUrl: string
  sourceBranch: string
  targetBranch: string
}

export type GitlabPipeline = {
  id: number
  status: string
  source: string
  ref: string | null
  sha: string
  webUrl: string
  createdAt: string
  updatedAt: string
}

export type GitlabNamespace = {
  kind: 'group' | 'user'
  id: number
  name: string
  fullPath: string
  avatarUrl: string | null
  webUrl: string
  projectCount: number
}

export type GitlabBindingNamespaces = {
  bindingId: string
  hostUrl: string
  username: string
  namespaces: GitlabNamespace[]
}

export type GitlabBindResult = {
  bindingId: string
  teamId: string
  hostUrl: string
  username: string
}

export type LinearWorkspace = {
  id: string
  label: string
  workspaceId: string
  workspaceName: string
  organizationUrlKey: string | null
  accountName: string | null
  scope: string
  createdAt?: string
}

export type LinearBindResult = {
  bindingId: string
  teamId: string
  workspaceName: string
}

export type JiraSite = {
  id: string
  label: string
  cloudId: string
  siteName: string
  siteUrl: string
  accountName: string | null
  scope: string
  createdAt?: string
}

export type JiraBindResult = {
  bindingId: string
  teamId: string
  siteName: string
}

export type AsanaAccount = {
  id: string
  label: string
  accountGid: string
  accountName: string | null
  accountEmail: string | null
  scope: string
  createdAt?: string
}

export type AsanaBindResult = {
  bindingId: string
  teamId: string
  accountName: string
}

export type SentryAccount = {
  id: string
  label: string
  userId: string
  userName: string | null
  userEmail: string | null
  scope: string
  createdAt?: string
}

export type SentryBindResult = {
  bindingId: string
  teamId: string
  accountName: string
}
