import type { AliyunSite, TencentSite } from '@/lib/byos/types'
import type { BindingAccess, BindingPurpose, EncryptedEnvelope } from '@/models/common'
import type { ObjectId } from 'mongodb'

export type AwsRoleBinding = {
  id: ObjectId
  roleArn: string
  createdAt: Date
  access?: BindingAccess
  purpose?: BindingPurpose
}

export type GcpServiceAccountBinding = {
  id: ObjectId
  serviceAccountEmail: string
  projectId: string
  createdAt: Date
  access?: BindingAccess
  purpose?: BindingPurpose
}

/**
 * Bring-your-own-credential Tencent binding: the team provides its own CAM
 * SecretId/SecretKey (a sub-user scoped to TKE), like Linode/Secureframe. The
 * SecretKey is encrypted at rest; the SecretId is the non-secret identifier.
 */
export type TencentAccountBinding = {
  id: ObjectId
  label: string
  /**
   * Which Tencent Cloud partition this credential belongs to (mainland China vs
   * International). Optional for backward-compat: legacy bindings without it are
   * treated as `china` (the original behavior). See {@link TencentSite}.
   */
  site?: TencentSite
  /**
   * OIDC web-identity federation (like AWS/Aliyun/Volcengine): the customer
   * creates a CAM OIDC identity provider trusting the Nuphos issuer and a CAM
   * role trusting that provider. We store only the role ARN + the OIDC provider
   * name (Tencent references the provider by name, not ARN, in
   * AssumeRoleWithWebIdentity) — no customer secret — and assume the role for
   * short-lived credentials on demand.
   */
  roleArn: string
  providerId: string
  createdAt: Date
  access?: BindingAccess
}

/**
 * Bring-your-own-credential Alibaba Cloud (Aliyun) binding: the team provides
 * its own RAM AccessKeyId/AccessKeySecret (a sub-user scoped to ACK/ECS), like
 * Tencent/Linode. The AccessKeySecret is encrypted at rest; the AccessKeyId is
 * the non-secret identifier.
 */
export type AliyunAccountBinding = {
  id: ObjectId
  label: string
  /**
   * Which Alibaba Cloud partition this binding belongs to (China vs
   * International). Optional for backward-compat: legacy bindings without it are
   * treated as `china` (the original behavior). See {@link AliyunSite}.
   */
  site?: AliyunSite
  /**
   * OIDC web-identity federation (like AWS/Volcengine): the customer creates a
   * RAM OIDC identity provider trusting the Nuphos issuer and a RAM role trusting
   * that provider. We store only the role ARN + the OIDC provider ARN (both
   * required by sts:AssumeRoleWithOIDC) — no customer secret — and assume the
   * role for short-lived credentials on demand.
   */
  roleArn: string
  oidcProviderArn: string
  createdAt: Date
  access?: BindingAccess
}

/**
 * Trust-relationship Volcengine (火山引擎) binding (like AWS role ARNs): the
 * team creates an IAM role whose trust policy allows the Nuphos connector
 * account to sts:AssumeRole. We store only the role TRN — no customer secret —
 * and assume it for short-lived credentials on demand.
 */
export type VolcengineAccountBinding = {
  id: ObjectId
  label: string
  /** Volcengine IAM role TRN, e.g. trn:iam::2100000000:role/NuphosRole. */
  roleTrn: string
  createdAt: Date
  access?: BindingAccess
}

// Huawei Cloud (华为云) binding: the IAM identity provider plus the trust
// agency assigned to its audience is the trust relationship (no AssumeRole).
export type HuaweiAccountBinding = {
  id: ObjectId
  label: string
  domainId: string
  idpId: string
  agencyName: string
  createdAt: Date
  access?: BindingAccess
}

export type CloudflareAccountBinding = {
  id: ObjectId
  accountId: string
  accountName: string | null
  /** How this account authenticates. Defaults to 'api_token' for legacy
   *  bindings that predate OAuth (encryptedApiKey present, authType absent). */
  authType?: 'api_token' | 'oauth'
  /** Present for api_token bindings (a scoped Cloudflare API token). */
  encryptedApiKey?: {
    v: 1
    alg: 'A256GCM'
    keyId: string
    iv: string
    authTag: string
    ciphertext: string
  }
  /** Present for oauth bindings. Short-lived access token is auto-refreshed
   *  from the refresh token before it expires (see cloudflare-oauth.ts). */
  oauth?: {
    clientId: string
    scope: string
    encryptedAccessToken: EncryptedEnvelope
    encryptedRefreshToken: EncryptedEnvelope | null
    accessTokenExpiresAt: Date | null
  }
  /**
   * Optional R2 S3-compatible credentials, bound separately from the account API
   * token. Needed only for the R2 object browser (list/upload/download/delete
   * objects); bucket-level operations use the account API token above.
   */
  r2S3?: {
    accessKeyId: string
    encryptedSecretAccessKey: EncryptedEnvelope
    createdAt: Date
  }
  createdAt: Date
  access?: BindingAccess
}

export type LinodeAccountBinding = {
  id: ObjectId
  label: string
  encryptedToken: {
    v: 1
    alg: 'A256GCM'
    keyId: string
    iv: string
    authTag: string
    ciphertext: string
  }
  createdAt: Date
  access?: BindingAccess
}

/**
 * A Kubernetes cluster in a customer's own network that we can only reach
 * through the relay (apps/kube-relay): the API server address is internal and
 * never routable from here.
 */
export type OnpremClusterBinding = {
  id: ObjectId
  label: string
  /**
   * Opaque id the relay knows this cluster by — the `k` claim of every token
   * issued for it. Rotating it is how access is revoked: tokens carrying the old
   * key stop resolving to anything, including the one in the customer's cluster.
   */
  clusterKey: string
  /**
   * The API server as seen from INSIDE the cluster (e.g. https://10.0.0.1:6443).
   * Stored alongside the kubeconfig so it can be shown without decrypting.
   * Absent until a credential is supplied.
   */
  endpoint?: string
  /**
   * Full kubeconfig the customer issued, credential included.
   *
   * Optional because enrolment deliberately runs tunnel-first: the customer
   * installs the agent and watches it connect BEFORE handing over any
   * credential, so there is a real state where a cluster is reachable and has
   * none. Nothing about it reaches an agent session until this is set.
   */
  encryptedKubeconfig?: {
    v: 1
    alg: 'A256GCM'
    keyId: string
    iv: string
    authTag: string
    ciphertext: string
  }
  createdAt: Date
  /** Set when the agent token was last (re-)issued; a rotation audit trail. */
  tokenIssuedAt: Date
  access?: BindingAccess
  purpose?: BindingPurpose
}

export type HetznerAccountBinding = {
  id: ObjectId
  label: string
  encryptedToken: {
    v: 1
    alg: 'A256GCM'
    keyId: string
    iv: string
    authTag: string
    ciphertext: string
  }
  createdAt: Date
  access?: BindingAccess
}

export type UpstashAccountBinding = {
  id: ObjectId
  label: string
  // Upstash Management API auth is HTTP Basic with the account email as the
  // username and the API key as the password. The email is the non-secret half
  // (and the only way to tell two bindings apart in the UI), so it stays
  // plaintext; the key is encrypted at rest. No OAuth, no token exchange.
  email: string
  encryptedApiKey: EncryptedEnvelope
  createdAt: Date
  access?: BindingAccess
}

/**
 * Microsoft Azure binding via OIDC workload identity federation (like
 * AWS/Tencent/Aliyun/Volcengine): the customer creates an Entra ID app
 * registration with a federated credential trusting the Nuphos issuer and grants
 * it an RBAC role on a subscription. We store only the tenant id, the app's
 * client id, and the subscription id — no client secret — mint a per-team token,
 * and exchange it for a short-lived ARM access token on demand.
 */
export type AzureAccountBinding = {
  id: ObjectId
  label: string
  /** Entra ID (Azure AD) tenant GUID the app registration lives in. */
  tenantId: string
  /** App registration (client/application) GUID the federated credential is on. */
  clientId: string
  /** Subscription GUID whose resources this binding enumerates. */
  subscriptionId: string
  createdAt: Date
  access?: BindingAccess
  /** Legacy marker; retired privileged bindings must not become agent credentials. */
  purpose?: BindingPurpose
}
