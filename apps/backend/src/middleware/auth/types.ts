import type { TailscaleBindingAuth } from '@/lib/byos/tailscale-binding'
import type { NuphosTeamRole, NuphosUser, NuphosTeam } from '@/lib/identity'
import type {
  AwsRoleBinding,
  BindingAccess,
  BetterStackIntegrationBinding,
  UptimeKumaInstanceBinding,
  CloudflareAccountBinding,
  GcpServiceAccountBinding,
  GitlabBinding,
  LinearWorkspaceBinding,
  VantaIntegrationBinding,
  SecureframeIntegrationBinding,
  SonarqubeIntegrationBinding,
  NotionIntegrationBinding,
  PosthogIntegrationBinding,
  UpstashAccountBinding,
  ResendIntegrationBinding,
  JiraSiteBinding,
  AsanaAccountBinding,
  SentryAccountBinding,
  TailscaleSandboxAccess,
  ZeaburProviderBinding,
} from '@/models'

export type AuthVariables = {
  userId: string
  userEmail: string
  userName: string
  user: NuphosUser
  authToken: string
  /** Scoped Claude-runtime token metadata; absent for normal user sessions. */
  previewConversationOwnerUserId?: string
}

export type TeamAuthVariables = AuthVariables & {
  teamId: string
  teamRole: NuphosTeamRole
  team: NuphosTeam
}

export type AwsAccountVariables = TeamAuthVariables & {
  accountId: string
  awsBindings: AwsRoleBinding[]
  awsRoleArn: string
  awsBinding: AwsRoleBinding
  awsBindingExplicit: boolean
}

export type GcpProjectVariables = TeamAuthVariables & {
  projectId: string
  gcpBindings: GcpServiceAccountBinding[]
  serviceAccountEmail: string
  gcpBinding: GcpServiceAccountBinding
  gcpBindingExplicit: boolean
}

export type GrafanaInstanceVariables = TeamAuthVariables & {
  grafanaInstanceId: string
  grafanaUrl: string
  grafanaSaToken: string
  grafanaName: string
}

export type GithubInstallationVariables = TeamAuthVariables & {
  githubInstallationId: number
  githubAccountLogin: string
  githubAccountType: 'User' | 'Organization'
}

export type GitlabBindingVariables = TeamAuthVariables & {
  gitlabBindingId: string
  gitlabBinding: GitlabBinding
}

type CloudflareEncryptedSecret = {
  v: 1
  alg: 'A256GCM'
  keyId: string
  iv: string
  authTag: string
  ciphertext: string
}

export type LinearWorkspaceVariables = TeamAuthVariables & {
  linearWorkspaceId: string
  linearBinding: LinearWorkspaceBinding
  linearLabel: string
  linearAccess?: BindingAccess
}

export type JiraSiteVariables = TeamAuthVariables & {
  jiraSiteId: string
  jiraBinding: JiraSiteBinding
  jiraLabel: string
  jiraAccess?: BindingAccess
}

export type AsanaAccountVariables = TeamAuthVariables & {
  asanaAccountId: string
  asanaBinding: AsanaAccountBinding
  asanaLabel: string
  asanaAccess?: BindingAccess
}

export type SentryAccountVariables = TeamAuthVariables & {
  sentryAccountId: string
  sentryBinding: SentryAccountBinding
  sentryLabel: string
  sentryAccess?: BindingAccess
}

export type CloudflareAccountVariables = TeamAuthVariables & {
  cloudflareAccountId: string
  cloudflareAccountName: string | null
  /** The full binding — the route layer resolves a bearer token from it
   *  (decrypt static api token, or refresh the OAuth access token). */
  cloudflareBinding: CloudflareAccountBinding
  /** Present only for legacy api_token bindings. Null for OAuth bindings. */
  cloudflareEncryptedApiKey: CloudflareEncryptedSecret | null
  /** R2 S3 credentials, present only when bound for the object browser. */
  cloudflareR2S3: {
    accessKeyId: string
    encryptedSecretAccessKey: CloudflareEncryptedSecret
    createdAt: Date
  } | null
}

export type LinodeAccountVariables = TeamAuthVariables & {
  linodeAccountId: string
  linodeAccountLabel: string
  linodeAccess?: BindingAccess
  linodeEncryptedToken: {
    v: 1
    alg: 'A256GCM'
    keyId: string
    iv: string
    authTag: string
    ciphertext: string
  }
}

export type HetznerAccountVariables = TeamAuthVariables & {
  hetznerAccountId: string
  hetznerAccountLabel: string
  hetznerAccess?: BindingAccess
  hetznerEncryptedToken: {
    v: 1
    alg: 'A256GCM'
    keyId: string
    iv: string
    authTag: string
    ciphertext: string
  }
}

export type VantaIntegrationVariables = TeamAuthVariables & {
  vantaIntegrationId: string
  vantaIntegrationLabel: string
  vantaAccess?: BindingAccess
  /** The full binding — the route layer resolves a bearer token from it
   *  (mint a client_credentials token, or refresh the OAuth access token). */
  vantaBinding: VantaIntegrationBinding
}

export type SecureframeIntegrationVariables = TeamAuthVariables & {
  secureframeIntegrationId: string
  secureframeIntegrationLabel: string
  secureframeAccess?: BindingAccess
  /** The full binding — the route layer decrypts the secret for the static
   *  API key/secret Authorization header. */
  secureframeBinding: SecureframeIntegrationBinding
}

export type SonarqubeIntegrationVariables = TeamAuthVariables & {
  sonarqubeIntegrationId: string
  sonarqubeIntegrationLabel: string
  sonarqubeAccess?: BindingAccess
  sonarqubeBinding: SonarqubeIntegrationBinding
}

export type NotionIntegrationVariables = TeamAuthVariables & {
  notionIntegrationId: string
  notionIntegrationLabel: string
  notionAccess?: BindingAccess
  /** The full binding — the credentials route decrypts the token to hand it to
   *  the agent sandbox. */
  notionBinding: NotionIntegrationBinding
}

export type UpstashAccountVariables = TeamAuthVariables & {
  upstashAccountId: string
  upstashAccountLabel: string
  upstashAccess?: BindingAccess
  /** The full binding — the credentials route decrypts the API key to hand it
   *  to the agent sandbox. */
  upstashBinding: UpstashAccountBinding
}

export type ResendIntegrationVariables = TeamAuthVariables & {
  resendIntegrationId: string
  resendIntegrationLabel: string
  resendAccess?: BindingAccess
  /** The full binding — the credentials route decrypts the API key to hand it to
   *  the agent sandbox. */
  resendBinding: ResendIntegrationBinding
}

export type PosthogIntegrationVariables = TeamAuthVariables & {
  posthogIntegrationId: string
  posthogAccess?: BindingAccess
  posthogBinding: PosthogIntegrationBinding
}

export type BetterStackIntegrationVariables = TeamAuthVariables & {
  betterStackIntegrationId: string
  betterStackBinding: BetterStackIntegrationBinding
  betterStackLabel: string
  betterStackAccess?: BindingAccess
  betterStackEncryptedUptimeApiToken?: NonNullable<
    BetterStackIntegrationBinding['encryptedUptimeApiToken']
  >
  betterStackEncryptedTelemetryApiToken?: NonNullable<
    BetterStackIntegrationBinding['encryptedTelemetryApiToken']
  >
}

export type UptimeKumaInstanceVariables = TeamAuthVariables & {
  uptimeKumaInstanceId: string
  uptimeKumaBinding: UptimeKumaInstanceBinding
  uptimeKumaLabel: string
  uptimeKumaAccess?: BindingAccess
}

export type TailscaleClientVariables = TeamAuthVariables & {
  tailscaleClientId: string
  tailscaleClientLabel: string
  tailscaleClientOAuthId: string
  tailscaleAccess?: BindingAccess
  tailscaleSandboxAccess?: TailscaleSandboxAccess
  tailscaleBindingAuth: TailscaleBindingAuth
}

export type ZeaburProviderVariables = TeamAuthVariables & {
  zeaburId: string
  zeaburKind: 'user' | 'team'
  zeaburName: string
  zeaburEncryptedToken: ZeaburProviderBinding['encryptedToken']
}
