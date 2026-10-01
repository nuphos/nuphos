import type { BindingAccess } from './k8s-core.ts'

export type AtlasCluster = {
  provider: 'aws' | 'gcp' | 'tencent' | 'aliyun' | 'volcengine' | 'azure'
  name: string
  region: string
  endpoint?: string
  status?: string
  version?: string
  createdAt?: string
  awsRoleArn?: string
  awsClusterArn?: string
  gcpServiceAccountEmail?: string
  gcpProjectId?: string
  gcpResourceName?: string
  tencentAccountId?: string
  tencentClusterId?: string
  aliyunAccountId?: string
  aliyunClusterId?: string
  volcengineAccountId?: string
  volcengineClusterId?: string
  azureAccountId?: string
  /** ARM resource group the AKS cluster lives in — needed to disambiguate same-named clusters. */
  azureResourceGroup?: string
}

export type AtlasClustersResponse = {
  clusters: AtlasCluster[]
  errors: { provider: string; bindingId: string; region?: string; message: string }[]
}

/** Legacy marker for retired bindings (never handed to the agent).
 *  null/undefined = a normal operational binding. */
export type BindingPurpose = 'permission-admin' | null

export type AwsAccount = {
  roleId: string
  accountId: string
  roleArn: string
  access?: BindingAccess
  alias?: string
  canUse?: boolean
  createdAt?: string
  purpose?: BindingPurpose
}

export type GcpProject = {
  serviceAccountId: string
  projectId: string
  serviceAccountEmail: string
  access?: BindingAccess
  alias?: string
  canUse?: boolean
  createdAt?: string
  purpose?: BindingPurpose
  /** Findings that don't invalidate the binding — currently a permission-admin
   *  SA that can grant roles but not create custom ones. Returned by the bind
   *  call and re-probed whenever the account is listed. */
  warnings?: string[]
}

export type CloudflareAccount = {
  id: string
  accountId: string
  accountName: string | null
  authType: 'oauth' | 'api_token'
  createdAt?: string
}

export type LinodeAccount = {
  id: string
  label: string
  createdAt?: string
}

export type HetznerAccount = {
  id: string
  label: string
  createdAt?: string
}

export type VantaIntegration = {
  id: string
  label: string
  orgDisplayName: string | null
  authType: 'client_credentials' | 'oauth'
  createdAt?: string
}

export type SecureframeIntegration = {
  id: string
  label: string
  region: 'us' | 'uk'
  createdAt?: string
}

export type SonarqubeIntegration = {
  id: string
  label: string
  baseUrl: string
  version: string | null
  createdAt?: string
}

export type SonarqubeProject = {
  key: string
  name: string
  qualifier?: string
  visibility?: string
  lastAnalysisDate?: string
  revision?: string
}

export type SonarqubeProjectsPage = {
  paging?: {
    pageIndex: number
    pageSize: number
    total: number
  }
  components?: SonarqubeProject[]
}

export type NotionIntegration = {
  id: string
  label: string
  workspaceName?: string | null
  createdAt?: string
}

export type UpstashAccount = {
  id: string
  label: string
  email: string
  createdAt?: string
}

// A bound Resend account. `permission` is probed by the backend at bind time:
// a sending-access key can only send mail, not read domains/audiences.
export type ResendIntegration = {
  id: string
  label: string
  permission: 'full_access' | 'sending_access'
  domains?: string[] | null
  createdAt?: string
}

// Tencent Cloud has two isolated partitions (like AWS aws vs aws-cn):
//  - 'china'         — cloud.tencent.com (mainland China)
//  - 'international'  — tencentcloud.com (global)
export type TencentSite = 'china' | 'international'

// A single Secureframe compliance check (mirrors the backend `SecureframeTest`).
export type SecureframeTest = {
  id: string
  description: string | null
  healthStatus: string | null
  enabled: boolean | null
  /** Why the test is failing (Secureframe's `failure_message`). */
  failureMessage: string | null
  /** How to fix it. */
  remediation: string | null
  raw: Record<string, unknown>
}

// A single Vanta compliance check (mirrors the backend `VantaTest`).
export type VantaTest = {
  id: string
  name: string
  category: string
  status: string
  failureDescription: string | null
  remediationDescription: string | null
  lastTestRunDate: string | null
}

export type TencentAccount = {
  id: string
  label: string
  site: TencentSite
  roleArn: string
  createdAt?: string
}

// OIDC federation details the customer needs to register Nuphos as a CAM OIDC
// identity provider and pin their role's trust policy. `jwks` is the signing
// public key — Tencent CAM (unlike the others) does not auto-fetch it.
export type TencentOidcInfo = {
  configured: boolean
  issuer: string
  audience: string
  subject: string
  jwks: string
}

// Alibaba Cloud has two isolated partitions (like AWS aws vs aws-cn):
//  - 'china'         — aliyun.com (mainland China)
//  - 'international'  — alibabacloud.com (global)
export type AliyunSite = 'china' | 'international'

export type AliyunAccount = {
  id: string
  label: string
  site: AliyunSite
  roleArn: string
  createdAt?: string
}

// OIDC federation details the customer needs to register Nuphos as a RAM OIDC
// identity provider and pin their role's trust policy.
export type AliyunOidcInfo = {
  configured: boolean
  issuer: string
  audience: string
  subject: string
}

export type VolcengineAccount = {
  id: string
  label: string
  roleTrn: string
  createdAt?: string
}

// OIDC federation details the customer needs to register Nuphos as a Volcengine
// IAM OIDC identity provider and pin their role's trust policy.
export type VolcengineOidcInfo = {
  configured: boolean
  issuer: string
  audience: string
  subject: string
}

export type HuaweiAccount = {
  id: string
  label: string
  domainId: string
  idpId: string
  agencyName: string
  createdAt?: string
}

// OIDC federation details the customer needs to register Nuphos as a Huawei
// Cloud IAM identity provider and assign a trust agency to this team's audience.
export type HuaweiOidcInfo = {
  configured: boolean
  issuer: string
  audience: string
  subject: string
}

export type AzureAccount = {
  id: string
  label: string
  tenantId: string
  clientId: string
  subscriptionId: string
  createdAt?: string
  // 'permission-admin' = human-only break-glass RBAC editor, never used by the agent.
  purpose?: 'permission-admin' | null
}

// One RBAC role the app holds on the subscription (or a narrower scope) — the
// "what can this app do" detail, analog of an AWS role's attached policies.
export type AzureRoleAssignment = {
  roleName: string
  roleDefinitionId: string
  scope: string
}

// OIDC workload identity federation details the customer needs to add a
// federated credential to their Entra ID app registration. Azure auto-fetches
// the JWKS from the issuer, so (unlike Tencent) no public key to paste.
export type AzureOidcInfo = {
  configured: boolean
  issuer: string
  subject: string
  audience: string
}

// Which Nuphos principal the customer grants Service Account Token Creator to.
// `principal` is this team's workload identity subject and the value the GCP
// wizard tells them to paste. A deploy without federation returns configured:
// false and cannot bind GCP accounts.
export type GcpWifInfo = {
  configured: boolean
  principal: string | null
}
