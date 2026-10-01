import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'

export const MIN_WIDTH_VW = 20
export const MAX_WIDTH_VW = 50
export const DEFAULT_WIDTH_VW = 36
export const AGENT_WIDTH_KEY = 'nuphos.agentWidthVw'
export const AGENT_PLACEHOLDER_PROMPTS = [
  'Create an EKS cluster in my AWS account.',
  'Set up a Grafana dashboard for my EC2 instances.',
  'Deploy a repo from GitHub to Cloud Run using a GitHub Action.',
  'Connect my ECS service to an S3 bucket.',
  'Analyze a 500 error trace from today.',
  'Update a DNS record in Cloudflare.',
  'Plan a migration from AWS to Linode.',
  'Generate a security report for my Cloud SQL database.',
  'Investigate an ongoing incident.',
] as const
// Static placeholder for the in-conversation composer. The rotating example
// prompts above are a hero-only (new chat) affordance — cycling them in an
// ongoing conversation reads as the input flickering.
// Nothing is connected yet, so the rotating examples must not imply write
// access — the first thing typed here should be something that can actually
// be answered once a read-only account is bound.
export const AGENT_FIRST_RUN_PLACEHOLDER_PROMPTS = [
  'What am I running in AWS right now?',
  'Where is my cloud spend going this month?',
  'Which resources are sitting idle?',
  'Is anything publicly exposed?',
  'Show me what changed in the last week.',
] as const
export const AGENT_COMPACT_PLACEHOLDER = 'Ask a follow-up...'
export const AGENT_QUEUE_PLACEHOLDER = 'Queue a follow-up — sends when this turn ends…'
export const SANDBOX_EXPIRED_MESSAGE =
  'The agent sandbox expired while running this command. A fresh sandbox will be used for the next step.'
export const STREAM_CHUNK_SIZES = {
  short: 12,
  medium: 24,
  long: 52,
  backlog: 112,
}
export const STREAM_DELAY_MS = {
  normal: 64,
  busy: 38,
  backlog: 18,
}
export const CREDENTIAL_SYNC_DEBOUNCE_MS = 500
export const CREDENTIAL_FOCUS_REFRESH_DEBOUNCE_MS = 1000
export const EMPTY_CREDENTIAL_ACCESS: AgentCredentialSelection = {
  awsRoleIds: [],
  gcpServiceAccountIds: [],
  linodeAccountIds: [],
  hetznerAccountIds: [],
  tencentAccountIds: [],
  aliyunAccountIds: [],
  volcengineAccountIds: [],
  huaweiAccountIds: [],
  azureAccountIds: [],
  onpremClusterIds: [],
  betterStackIntegrationIds: [],
  uptimeKumaInstanceIds: [],
  linearWorkspaceIds: [],
  jiraSiteIds: [],
  asanaAccountIds: [],
  sentryAccountIds: [],
  posthogIntegrationIds: [],
  tailscaleClientIds: [],
  zeaburIds: [],
  vantaIntegrationIds: [],
  secureframeIntegrationIds: [],
  resendIntegrationIds: [],
  githubInstallationIds: [],
  gitlabBindingIds: [],
  grafanaInstanceIds: [],
  sonarqubeIntegrationIds: [],
  notionIntegrationIds: [],
  upstashAccountIds: [],
  cloudflareAccountIds: [],
  deviceIds: [],
}

export const EMPTY_CREDENTIAL_OPTIONS: AgentCredentialOptions = {
  awsRoles: [],
  gcpServiceAccounts: [],
  linodeAccounts: [],
  hetznerAccounts: [],
  tencentAccounts: [],
  aliyunAccounts: [],
  volcengineAccounts: [],
  huaweiAccounts: [],
  azureAccounts: [],
  onpremClusters: [],
  betterStackIntegrations: [],
  uptimeKumaInstances: [],
  linearWorkspaces: [],
  jiraSites: [],
  asanaAccounts: [],
  sentryAccounts: [],
  posthogIntegrations: [],
  tailscaleClients: [],
  zeaburProviders: [],
  vantaIntegrations: [],
  secureframeIntegrations: [],
  resendIntegrations: [],
  githubInstallations: [],
  gitlabBindings: [],
  grafanaInstances: [],
  sonarqubeIntegrations: [],
  notionIntegrations: [],
  upstashAccounts: [],
  cloudflareAccounts: [],
  devices: [],
}

export const CONVERSATION_SWITCHER_LIMIT = 15
