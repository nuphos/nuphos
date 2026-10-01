import { call, withAwsRole, withGcpServiceAccount } from './client'

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
  warnings: string[]
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

// OAuth-bound accounts (the current bind flow): scopes + connection health
// instead of token policies.
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

export async function getAwsIamPermissions(
  teamId: string,
  accountId: string,
  roleId?: string,
): Promise<AwsIamPermissions> {
  return call<AwsIamPermissions>(
    'GET',
    withAwsRole(`/teams/${teamId}/aws-accounts/${accountId}/iam-permissions`, roleId),
  )
}

export async function getGcpIamPermissions(
  teamId: string,
  projectId: string,
  serviceAccountId?: string,
): Promise<GcpIamPermissions> {
  return call<GcpIamPermissions>(
    'GET',
    withGcpServiceAccount(
      `/teams/${teamId}/gcp-projects/${projectId}/iam-permissions`,
      serviceAccountId,
    ),
  )
}

export async function getCloudflareIamPermissions(
  teamId: string,
  accountId: string,
): Promise<CloudflareIamInfo> {
  return call<CloudflareIamInfo>(
    'GET',
    `/teams/${teamId}/cloudflare-accounts/${accountId}/iam-permissions`,
  )
}
