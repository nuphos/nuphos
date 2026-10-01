import type {
  DiscordConnection,
  AliyunAccount,
  AsanaAccount,
  AwsAccount,
  AzureAccount,
  BetterStackIntegration,
  CloudflareAccount,
  DatabaseConnection,
  GcpProject,
  GithubInstallation,
  GitlabBinding,
  GrafanaInstance,
  HetznerAccount,
  HuaweiAccount,
  JiraSite,
  LarkInstallation,
  LinearWorkspace,
  LinodeAccount,
  NotionIntegration,
  OnpremCluster,
  PosthogIntegration,
  ResendIntegration,
  SecureframeIntegration,
  SentryAccount,
  SlackInstallation,
  SlackLinkedChannelsSummary,
  SonarqubeIntegration,
  TailscaleOAuthClient,
  TencentAccount,
  UpstashAccount,
  UptimeKumaInstance,
  VantaIntegration,
  VolcengineAccount,
  ZeaburProvider,
} from '../../types'
import type { ConnectorInfoProvider } from '../ConnectorInfoView'

export type TeamHomeViewProps = {
  teamId: string
  awsAccounts: AwsAccount[]
  gcpProjects: GcpProject[]
  cloudflareAccounts: CloudflareAccount[]
  linodeAccounts: LinodeAccount[]
  hetznerAccounts: HetznerAccount[]
  vantaIntegrations: VantaIntegration[]
  secureframeIntegrations: SecureframeIntegration[]
  sonarqubeIntegrations: SonarqubeIntegration[]
  notionIntegrations: NotionIntegration[]
  onpremClusters: OnpremCluster[]
  upstashAccounts: UpstashAccount[]
  resendIntegrations: ResendIntegration[]
  tencentAccounts: TencentAccount[]
  aliyunAccounts: AliyunAccount[]
  volcengineAccounts: VolcengineAccount[]
  huaweiAccounts: HuaweiAccount[]
  azureAccounts: AzureAccount[]
  betterStackIntegrations: BetterStackIntegration[]
  uptimeKumaInstances: UptimeKumaInstance[]
  tailscaleClients: TailscaleOAuthClient[]
  zeaburProviders: ZeaburProvider[]
  githubInstallations: GithubInstallation[]
  gitlabBindings: GitlabBinding[]
  grafanaInstances: GrafanaInstance[]
  linearWorkspaces: LinearWorkspace[]
  jiraSites: JiraSite[]
  asanaAccounts: AsanaAccount[]
  sentryAccounts: SentryAccount[]
  posthogIntegrations: PosthogIntegration[]
  discordConnection?: DiscordConnection | null
  slackInstallation: SlackInstallation | null
  larkInstallation: LarkInstallation | null
  slackLinkedChannels: SlackLinkedChannelsSummary | null
  /** True until the team's aggregated connectors bundle has arrived. */
  loading: boolean
  filter: string
  onFilterChange: (filter: string) => void
  refreshKey: number
  onCount: (n: number) => void
  databaseConnections: DatabaseConnection[]
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat: (prompt: string) => void
  /** Open the full-screen settings overlay at the given section (Slack
   *  connectors live there). */
  onOpenSettingsSection: (section: string) => void
  /** Open the common connector-info drill-down. Providers with a dedicated
   *  resource browser expose it as the info page's primary action. */
  onOpenConnectorInfo: (detail: {
    provider: ConnectorInfoProvider
    connectorId: string
    name: string
  }) => void
  onChanged: () => void
  /** URL-driven open state for the "Add integration" marketplace modal. When
   *  omitted the modal falls back to local component state. */
  addIntegrationOpen?: boolean
  onAddIntegrationOpenChange?: (open: boolean) => void
  /** One-shot request (e.g. from the sidebar Slack promo) to open the Slack
   *  bind dialog; consumed via onSlackBindHandled so remounts don't reopen it. */
  slackBindRequested?: boolean
  onSlackBindHandled?: () => void
}
