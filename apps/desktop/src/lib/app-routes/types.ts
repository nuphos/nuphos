import type { DatasourceSummary } from '../../grafana/client'
import type { Scope } from '../../types'
import type { DetailTarget } from '../../views/DetailView'
import type { GithubNavState } from '../../views/GithubView'
import type { GitlabNavState } from '../../views/gitlabNav'

// ---------------------------------------------------------------------------
// Navigation types (moved from App.tsx — App re-imports them from here).
// ---------------------------------------------------------------------------

export type RepoProvider = 'github' | 'gitlab'

export type GrafanaSelection = { id: string; name: string; url: string } | null

export type AwsS3Detail = {
  bucket: string
  region: string
  prefix: string
}

export type AwsResourceDetailRef = {
  kind: 'lambda' | 'logGroup' | 'alarm'
  name: string
  region: string
}

export type CloudflareResourceDetailRef = {
  kind: 'worker' | 'r2' | 'pages' | 'd1' | 'kv'
  // Leaf label shown in the global breadcrumb (script/bucket/project name, D1
  // database name, KV namespace title).
  name: string
  // Stable id when it differs from the display name (D1 databaseId, KV
  // namespaceId); the list row name is not always the API id.
  id?: string
  // R2 object-browser path within the bucket; drives the breadcrumb prefix
  // segments exactly like s3Detail.prefix.
  prefix?: string
}

// Which active nav key each Cloudflare drill-down kind belongs to. Used by the
// breadcrumb to tell whether cloudflareDetail applies to the current view.
export const CLOUDFLARE_DETAIL_ACTIVE: Record<CloudflareResourceDetailRef['kind'], string> = {
  worker: 'cloudflare.workers',
  r2: 'cloudflare.r2',
  pages: 'cloudflare.pages',
  d1: 'cloudflare.d1',
  kv: 'cloudflare.kv',
}

/**
 * An open Triggers form. The trigger/group name rides along so the breadcrumb
 * can name what is being edited without waiting for the page to load it.
 */
export type TriggerFormRef =
  | { kind: 'create' }
  | { kind: 'edit'; triggerId: string; name: string; returnToDetail?: boolean }
  | { kind: 'group'; groupId: string; name: string }

// Connector basic-info drill-down (providers without a dedicated in-app view).
// Encoded into the URL as /connectors/<provider>/<id>.
export type ConnectorDetailRef = {
  provider: ConnectorInfoProvider
  connectorId: string
  /** Breadcrumb label; a URL-restored ref starts with the provider name and is
   *  refined by the info view once the connector loads. */
  name: string
}

// Open dashboard drill-down on the Dashboards page.
// The list view is represented by a null value.
export type NuphosDashboardRef = {
  dashboardId: string
  /** Breadcrumb label; a URL-restored ref starts as a placeholder and is
   *  refined by the view once the dashboard list loads. */
  dashboardName: string
  viewRange?: import('../../dashboards/schema').DashboardViewRange
}

export type LinearTeamRef = { id: string; key: string; name: string; url?: string | null }

// The Linear page (`team.linear`): teams of every bound workspace → one team's
// issues → one issue. URL-restored refs carry stub names the views refine.
export type LinearNavState =
  | { view: 'teams' }
  | { view: 'team'; bindingId: string; team: LinearTeamRef }
  | {
      view: 'issue'
      bindingId: string
      identifier: string
      title?: string
      url?: string
      team?: LinearTeamRef
    }

export type NavigationSnapshot = {
  scope: Scope
  active: string
  // List filter, captured so deep-links (e.g. Overview → Pods + `status=Running`)
  // survive back/forward and history restore. Optional: older snapshots and the
  // plain initial-navigation literals omit it and restore to an empty filter.
  filter?: string
  browserUrl?: string
  target: DetailTarget | null
  grafanaInstance: GrafanaSelection
  dashboardTarget: { uid: string; title: string; folderTitle?: string } | null
  traceDatasourceTarget: DatasourceSummary | null
  logDatasourceTarget: DatasourceSummary | null
  githubNav: GithubNavState
  gitlabNav?: GitlabNavState
  repoProvider: RepoProvider
  agentSessionId: string | null
  s3Detail: AwsS3Detail | null
  // Optional: older persisted snapshots omit it and restore to the list view.
  awsDetail?: AwsResourceDetailRef | null
  // Open architecture diagram drill-down — encoded into the URL so it round-trips.
  architectureDetail?: { diagramId: string; diagramName: string } | null
  // Selected dashboard — encoded into the URL so it round-trips.
  nuphosDashboard?: NuphosDashboardRef | null
  // Linear page drill-down — encoded into the URL so it round-trips.
  linearNav?: LinearNavState | null
  // Cloudflare drill-down (Workers/R2/Pages/D1/KV); mirrors awsDetail.
  cloudflareDetail?: CloudflareResourceDetailRef | null
  // Connector basic-info drill-down on the Connectors page; mirrors architectureDetail.
  connectorDetail?: ConnectorDetailRef | null
  // "Add integration" marketplace modal open state (integrations page only).
  addIntegrationOpen?: boolean
}

export type PageLocation = {
  pathname: string
  search: string
  href: string
}

/** The slice of tab runtime state the producer needs for SSH-terminal paths. */
export type SshTerminalLocation = { region: string; instanceName: string }

export const DEFAULT_GITHUB_NAV: GithubNavState = { view: 'installations' }
export const DEFAULT_REPO_PROVIDER: RepoProvider = 'github'

export const DEFAULT_KEY: Record<Scope['kind'], string> = {
  team: 'team.agent',
  'aws-account': 'aws.clusters',
  'gcp-project': 'gcp.clusters',
  'cloudflare-account': 'cloudflare.zones',
  'cloudflare-zone': 'cloudflare.dns',
  'linode-account': 'linode.instances',
  'hetzner-account': 'hetzner.servers',
  'tencent-account': 'tencent.clusters',
  'aliyun-account': 'aliyun.clusters',
  'volcengine-account': 'volcengine.clusters',
  'azure-subscription': 'azure.apps',
  'betterstack-integration': 'betterstack.monitors',
  'uptime-kuma-instance': 'uptime-kuma.monitors',
  'database-connection': 'database.overview',
  'compliance-integration': 'compliance.tests',
  'tailscale-client': 'tailscale.devices',
  'zeabur-provider': 'zeabur.projects',
  cluster: 'workloads.pods',
  'aws-ecs-cluster': 'ecs.services',
}

// Providers whose installed rows open the shared connector-info page, addressed
// as /teams/<id>/connectors/<provider>/<id>. Providers with a resource browser
// link to it from the info page instead of skipping the common entry point.
export const CONNECTOR_INFO_PROVIDERS = [
  'aws',
  'gcp',
  'cloudflare',
  'mongodb',
  'onprem-k8s',
  'notion',
  'upstash',
  'resend',
  'linear',
  'jira',
  'asana',
  'sentry',
  'posthog',
  'vanta',
  'secureframe',
  'sonarqube',
  'discord',
  'slack',
  'lark',
  'tailscale',
  'linode',
  'hetzner',
  'tencent',
  'aliyun',
  'volcengine',
  'huawei',
  'azure',
  'betterstack',
  'uptime-kuma',
  'zeabur',
  'github',
  'gitlab',
  'grafana',
] as const
export type ConnectorInfoProvider = (typeof CONNECTOR_INFO_PROVIDERS)[number]

export const CONNECTOR_INFO_LABELS: Record<ConnectorInfoProvider, string> = {
  aws: 'AWS',
  gcp: 'GCP',
  cloudflare: 'Cloudflare',
  mongodb: 'MongoDB',
  'onprem-k8s': 'Kubernetes',
  notion: 'Notion',
  upstash: 'Upstash',
  resend: 'Resend',
  linear: 'Linear',
  jira: 'Jira',
  asana: 'Asana',
  sentry: 'Sentry',
  posthog: 'PostHog',
  vanta: 'Vanta',
  secureframe: 'Secureframe',
  sonarqube: 'SonarQube',
  discord: 'Discord',
  slack: 'Slack',
  lark: 'Lark (Feishu)',
  tailscale: 'Tailscale',
  linode: 'Linode',
  hetzner: 'Hetzner Cloud',
  tencent: 'Tencent Cloud',
  aliyun: 'Alibaba Cloud',
  volcengine: 'Volcengine',
  huawei: 'Huawei Cloud',
  azure: 'Microsoft Azure',
  betterstack: 'Better Stack',
  'uptime-kuma': 'Uptime Kuma',
  zeabur: 'Zeabur',
  github: 'GitHub',
  gitlab: 'GitLab',
  grafana: 'Grafana',
}
