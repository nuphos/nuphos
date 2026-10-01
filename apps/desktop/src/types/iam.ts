export type AwsIamStatement = {
  effect: string
  actions: string[]
  notActions?: string[]
  resources: string[]
  notResources?: string[]
  conditionSummary?: string
}

export type AwsIamPolicy = {
  name: string
  kind: 'inline' | 'managed'
  arn?: string
  awsManaged?: boolean
  versionId?: string
  updatedAt?: string
  statements: AwsIamStatement[]
}

export type PermissionGrantProposalView = {
  id: string
  provider: 'aws' | 'gcp' | 'azure'
  /** 'revoke' only when every change is a revoke; otherwise 'grant' (incl. mixed). */
  action: 'grant' | 'revoke'
  changeCount: number
  status: 'proposed' | 'rejected' | 'executing' | 'executed' | 'failed'
  /** Summary label for lists, e.g. "Grant X" or "3 permission changes (...)". */
  grantLabel: string
  reason: string
  decisions: { label: string; value: string }[]
  permissionAdminLabel: string
  executionError: string | null
  createdAt?: string
  createdByUserId: string
  decidedByUserId: string | null
}

export type SelfCapabilities = {
  canRead: boolean
  canWrite: boolean
  inferred: boolean
  readReason: string
  writeReason: string
}

export type AwsIamPermissions = {
  accountId: string
  roleArn: string
  roleName: string
  trustPolicySummary: string | null
  callerArn: string | null
  callerUserId: string | null
  warnings: string[]
  policies: AwsIamPolicy[]
  selfCapabilities: SelfCapabilities
}

export type GcpRoleBinding = {
  role: string
  member: string
  condition?: { title?: string; description?: string; expression?: string }
}

export type GcpRoleDetails = {
  name: string
  title: string | null
  description: string | null
  stage: string | null
  includedPermissions: string[]
  truncated: boolean
  error: string | null
}

export type GcpIamPermissions = {
  projectId: string
  serviceAccountEmail: string
  /** The readout itself came back incomplete. */
  warnings: string[]
  /** The readout is fine; the binding is misconfigured for some operation. */
  bindingWarnings?: string[]
  bindings: GcpRoleBinding[]
  roles: GcpRoleDetails[]
  effectivePermissions: string[] | null
  selfCapabilities: SelfCapabilities
  serviceAccountCapabilities?: {
    canCreate: boolean
    canUpdate: boolean
    canDelete: boolean
    canSetIamPolicy: boolean
    reason: string
  }
}

export type CloudflareTokenPolicy = {
  effect: string
  resources: Record<string, string>
  permissionGroups: { id: string; name: string; scopes?: string[] }[]
}

export type CloudflareIamPermissions = {
  authType?: 'api_token'
  accountId: string
  tokenId: string | null
  tokenStatus: string | null
  tokenName: string | null
  expiresOn: string | null
  policies: CloudflareTokenPolicy[] | null
  warnings: string[]
  selfCapabilities: SelfCapabilities
}

// OAuth-bound accounts (the current bind flow): the meaningful facts are the
// granted scopes and connection health, not API-token policies.
export type CloudflareOauthConnection = {
  authType: 'oauth'
  accountId: string
  accountName: string | null
  clientId: string
  scopes: string[]
  accessTokenExpiresAt: string | null
  hasRefreshToken: boolean
  connectionStatus: 'ok' | 'error'
  warnings: string[]
}

export type CloudflareIamInfo = CloudflareIamPermissions | CloudflareOauthConnection

export type CloudflareZone = {
  id: string
  name: string
  status: string | null
  paused: boolean
  type: string | null
  nameServers: string[]
  originalNameServers: string[]
  createdAt: string | null
  modifiedAt: string | null
}

export type CloudflareDnsRecord = {
  id: string
  type: string
  name: string
  content: string
  ttl: number
  proxied: boolean | null
  proxiable: boolean
  priority: number | null
  comment: string | null
  tags: string[]
  createdAt: string | null
  modifiedAt: string | null
}

export type CloudflareDnsRecordInput = {
  type: string
  name: string
  content: string
  ttl?: number
  proxied?: boolean
  priority?: number
  comment?: string
}

/**
 * An IAM principal an administrator registered as a legitimate target of
 * permission-grant proposals. It carries no credential and never becomes an
 * identity the agent can assume.
 */
