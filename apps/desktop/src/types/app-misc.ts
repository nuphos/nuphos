import type {
  BetterStackIntegration,
  TailscaleOAuthClient,
  UptimeKumaInstance,
  ZeaburProvider,
} from './infra-integrations.ts'
import type { DiscordConnection, LarkInstallation, SlackInstallation } from './messaging'
import type {
  AsanaAccount,
  GithubInstallation,
  GitlabBinding,
  GrafanaInstance,
  JiraSite,
  LinearWorkspace,
  OnpremCluster,
  SentryAccount,
} from './onprem-git.ts'
import type { PosthogIntegration } from './posthog.ts'
import type {
  AliyunAccount,
  AwsAccount,
  AzureAccount,
  CloudflareAccount,
  GcpProject,
  HetznerAccount,
  HuaweiAccount,
  LinodeAccount,
  NotionIntegration,
  ResendIntegration,
  SecureframeIntegration,
  SonarqubeIntegration,
  TencentAccount,
  UpstashAccount,
  VantaIntegration,
  VolcengineAccount,
} from './provider-accounts.ts'

// ---------- Monitoring overview (BYOS aggregation) ----------

export type MonitoringOverviewRow = {
  provider: 'betterstack' | 'grafana' | 'gcp'
  integrationId: string
  integrationLabel: string
  providerResourceId: string
  kind: 'monitor' | 'heartbeat' | 'alert-rule' | 'alert-policy' | 'uptime-check'
  name: string
  status: 'up' | 'down' | 'paused' | 'pending' | 'unknown'
  statusLabel: string
  target: string | null
  lastIncidentAt: string | null
  providerUrl: string | null
}

export type MonitoringOverview = {
  rows: MonitoringOverviewRow[]
  providerErrors: {
    provider: 'betterstack' | 'grafana' | 'gcp'
    integrationId: string
    integrationLabel: string
    message: string
  }[]
}

// ---------- File transfer ----------

export type FileTransferFile = {
  id: string
  fileName: string
  relPath: string
  size: number | null
  contentType: string | null
  status: 'pending' | 'ready' | 'failed' | 'expired'
  downloadUrl?: string
}

export type FileTransferGroup = {
  groupId: string
  direction: 'upload' | 'download'
  status: 'pending' | 'ready' | 'partial' | 'failed' | 'expired'
  label: string | null
  // ISO timestamp of the push. The chat anchors a download card to the turn it
  // came from by comparing this against the assistant messages' times.
  createdAt: string
  // ISO timestamp; after this the objects are gone (S3 lifecycle + Mongo TTL)
  // and downloads will fail. The UI disables actions past it.
  expiresAt: string
  files: FileTransferFile[]
  // Set by the desktop uploader when a folder / multi-file selection
  // was packed into a single .zip object: the agent must pull-and-extract it.
  // Single-file uploads leave this undefined.
  archive?: boolean
  archiveEntryCount?: number
}

// Aggregated connector inventory returned by GET /teams/:id/connectors — every
// binding the Connectors page shows, in one round trip. Field shapes match the
// corresponding per-provider list endpoints exactly.
export type TeamConnectorsBundle = {
  // Optional: an older/mismatched backend may omit it, in which case the
  // catalog simply doesn't pre-warn (the backend still enforces on bind).
  aws: AwsAccount[]
  gcp: GcpProject[]
  cloudflare: CloudflareAccount[]
  linode: LinodeAccount[]
  hetzner: HetznerAccount[]
  tencent: TencentAccount[]
  aliyun: AliyunAccount[]
  volcengine: VolcengineAccount[]
  huawei: HuaweiAccount[]
  azure: AzureAccount[]
  vanta: VantaIntegration[]
  secureframe: SecureframeIntegration[]
  sonarqube: SonarqubeIntegration[]
  notion: NotionIntegration[]
  onprem: OnpremCluster[]
  upstash: UpstashAccount[]
  resend: ResendIntegration[]
  betterstack: BetterStackIntegration[]
  uptimeKuma: UptimeKumaInstance[]
  tailscale: TailscaleOAuthClient[]
  zeabur: ZeaburProvider[]
  github: GithubInstallation[]
  gitlab: GitlabBinding[]
  grafana: GrafanaInstance[]
  linear: LinearWorkspace[]
  jira: JiraSite[]
  asana: AsanaAccount[]
  sentry: SentryAccount[]
  posthog?: PosthogIntegration[]
  discord?: DiscordConnection
  slack: {
    installation: SlackInstallation | null
    oauthAvailable: boolean
    // Channel-scoped Slack access: enabled channel mappings, including ones
    // served by other workspaces' installations (grantWorkspaces).
    linkedChannels?: SlackLinkedChannelsSummary
  }
  lark: { installation: LarkInstallation | null }
}

export type SlackLinkedChannelsSummary = {
  count: number
  grantWorkspaces: { id: string; name: string | null }[]
}
