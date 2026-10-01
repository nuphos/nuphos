import type { DatasourceSummary } from '../grafana/client'
import type {
  AwsResourceDetailRef,
  AwsS3Detail,
  CloudflareResourceDetailRef,
  ConnectorDetailRef,
  LinearNavState,
  NuphosDashboardRef,
  GrafanaSelection,
  NavigationSnapshot,
  PageLocation,
  RepoProvider,
  TriggerFormRef,
} from '../lib/appRoutes'
import type {
  DiscordConnection,
  AliyunAccount,
  AsanaAccount,
  AwsAccount,
  AzureAccount,
  BetterStackIntegration,
  CloudflareAccount,
  DatabaseEngine,
  GcpProject,
  HetznerAccount,
  HuaweiAccount,
  JiraSite,
  LarkInstallation,
  LinearWorkspace,
  LinodeAccount,
  NotionIntegration,
  OnpremCluster,
  ResendIntegration,
  Scope,
  SecureframeIntegration,
  SentryAccount,
  PosthogIntegration,
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
} from '../types'
import type { DetailTarget } from '../views/DetailView'
import type { GithubNavState } from '../views/GithubView'
import type { GitlabNavState } from '../views/gitlabNav'

/** One connector row in the breadcrumb's connector segment and its sibling
 *  picker. `engine` stands in for the provider mark on bindings that have none
 *  (databases), which is why it is the engine and not a rendered icon — the
 *  crumb and the picker draw it at different sizes. */
export type ConnectorCrumbEntry = {
  id: string
  label: string
  sublabel?: string
  engine?: DatabaseEngine
}

export type AccountSet = {
  aws: AwsAccount[]
  gcp: GcpProject[]
  cloudflare: CloudflareAccount[]
  linode: LinodeAccount[]
  hetzner: HetznerAccount[]
  vanta: VantaIntegration[]
  secureframe: SecureframeIntegration[]
  sonarqube: SonarqubeIntegration[]
  notion: NotionIntegration[]
  onprem: OnpremCluster[]
  upstash: UpstashAccount[]
  resend: ResendIntegration[]
  tencent: TencentAccount[]
  aliyun: AliyunAccount[]
  volcengine: VolcengineAccount[]
  huawei: HuaweiAccount[]
  azure: AzureAccount[]
  betterstack: BetterStackIntegration[]
  uptimeKuma: UptimeKumaInstance[]
  tailscale: TailscaleOAuthClient[]
  zeabur: ZeaburProvider[]
  linear: LinearWorkspace[]
  jira: JiraSite[]
  asana: AsanaAccount[]
  sentry: SentryAccount[]
  posthog: PosthogIntegration[]
  discordConnection?: DiscordConnection | null
  slackInstallation: SlackInstallation | null
  slackLinkedChannels: SlackLinkedChannelsSummary | null
  larkInstallation: LarkInstallation | null
}

export type AgentPromptSeed = {
  text: string
  nonce: number
  filePaths?: string[]
  autoSend?: boolean
  newChat?: boolean
  mode?: 'mention' | 'text'
  // Clear the composer before inserting — prefill shortcuts (send: false)
  // replace any draft instead of stacking onto it on repeated clicks.
  replace?: boolean
}

export type SshTerminalTabState = {
  instanceName: string
  region: string
  publicIp: string | null
  username: string | null
  sessionId: string | null
  status: 'connecting' | 'connected' | 'error'
  error: string | null
}

export type WorkspacePageMeta = {
  key: string
  title: string
  icon: React.ReactNode
  iconKey?: string
  location: PageLocation
}

export type WorkspaceTabState = {
  id: string
  /**
   * Creation order within this run of the app — fixed for the tab's whole life,
   * never persisted. Panes whose DOM node must not be moved (a browser tab's
   * `<webview>` reloads if it is) are rendered in this order, so a new one can
   * only land at the end. See `workspace/browserPaneOrder.ts`.
   */
  createdSeq: number
  scope: Scope
  active: string
  filter: string
  browserUrl?: string
  refreshKey: number
  /**
   * Background poll signal: bumped every 5 s for the active tab while the
   * window is visible. Manual-fetch views include it in their effect deps so
   * the table re-pulls on each tick; the K8s watch hook ignores it (the
   * stream is already live, and re-subscribing every 5 s would flash the
   * loading state).
   */
  pollTick: number
  count: number
  viewLoading: boolean
  target: DetailTarget | null
  grafanaInstance: GrafanaSelection
  dashboardTarget: { uid: string; title: string; folderTitle?: string } | null
  traceDatasourceTarget: DatasourceSummary | null
  logDatasourceTarget: DatasourceSummary | null
  githubNav: GithubNavState
  gitlabNav?: GitlabNavState
  repoProvider: RepoProvider
  // Open architecture diagram (drill-down). Lives on the tab so the global
  // breadcrumb shows the diagram name; clicking the crumb clears it. Optional —
  // not persisted across tab restore yet.
  architectureDetail?: { diagramId: string; diagramName: string } | null
  /** Open dashboard drill-down; mirrors architectureDetail. Null means
   *  the Dashboards list page. */
  nuphosDashboard?: NuphosDashboardRef | null
  /** Dashboard list reported by the view (like `namespaces`): feeds the
   *  breadcrumb switcher and the default-view crumb label. Never serialized. */
  nuphosDashboards?: { id: string; name: string }[]
  /** Linear page drill-down (`team.linear`); null means its team list. */
  linearNav?: LinearNavState | null
  s3Detail: AwsS3Detail | null
  /**
   * Drill-down selection for AWS detail pages (Lambda function, CloudWatch
   * log group / alarm). Mirrors `s3Detail`: living on the tab means the
   * breadcrumb shows the resource name, clicking the crumb returns to the
   * list, and the toolbar refresh drives reloads — no per-view chrome.
   */
  awsDetail?: AwsResourceDetailRef | null
  /** Cloudflare drill-down (Workers/R2/Pages/D1/KV); mirrors awsDetail. */
  cloudflareDetail?: CloudflareResourceDetailRef | null
  /** Connector basic-info drill-down on the Connectors page; mirrors architectureDetail. */
  connectorDetail?: ConnectorDetailRef | null
  /** Open trigger on the Triggers page — its runs, read in place. Mirrors
   *  architectureDetail: on the tab so the breadcrumb names the trigger and
   *  the crumb above it returns to the list, which is why the page itself
   *  carries no title bar or back button. */
  triggerDetail?: { triggerId: string; triggerName: string } | null
  /** Open Triggers form. Here rather than inside the page for the same reason
   *  as triggerDetail: the breadcrumb names it, and the toolbar knows to drop
   *  the list's search and count — a form filters nothing. */
  triggerForm?: TriggerFormRef | null
  /** Whether the "Add integration" marketplace modal is open on the integrations
   *  page. Encoded into the URL (?add-modal-opened) so it round-trips. */
  addIntegrationOpen?: boolean
  namespaces: string[]
  /**
   * Namespace-picker fetch state. The list is loaded lazily (on first open of
   * the picker) and capped to one page, because a cluster can have tens of
   * thousands of namespaces — see `listNamespaceNames`. `namespacesTruncated`
   * drives the "not everything is here" note (the count is optional and must
   * never gate it) so a partial list is never presented as complete.
   */
  namespacesState?: 'idle' | 'loading' | 'loaded'
  /** True when the cluster holds more namespaces than the fetched page. */
  namespacesTruncated?: boolean
  /** The cluster's real namespace count, when the server reports one. */
  namespacesTotal?: number | null
  switching: boolean
  clusterLabel: string | null
  /**
   * The kubeconfig context name this tab routes k8s IPC through. Populated by
   * `enterCluster` after `atlas:useXxxCluster` returns; null for non-cluster
   * scopes. Not persisted: on app restart we re-call useXxxCluster for any
   * restored cluster-scoped tab to get a fresh ephemeral context.
   */
  kubeconfigContext: string | null
  /**
   * Set when the auto-rehydrate attempt for this cluster tab failed. Until
   * the user explicitly retries (re-picking the cluster via `enterCluster`),
   * the rehydrate effect skips this tab so a failing call (network, expired
   * auth, etc.) doesn't loop the Nuphos API on every state change.
   */
  kubeconfigContextError: string | null
  sshTerminal: SshTerminalTabState | null
  pageMeta: WorkspacePageMeta | null
  navHistory: NavigationSnapshot[]
  navHistoryIndex: number
  agentSessionId: string | null
  /**
   * Whether the Agent page's conversation rail is open in THIS tab. Per tab
   * rather than a global preference: two tabs are two things being looked at,
   * and one wanting the list says nothing about the other. Absent — which is
   * every new tab — means collapsed; the page is a conversation first.
   */
  agentRailCollapsed?: boolean
  /**
   * Tab-strip label carried over from a persisted session, used only until the
   * tab is first activated and its content mounts (which recomputes `pageMeta`
   * with the live title). Lets restored-but-unmounted tabs — especially agent
   * chats — show their real label instead of the generic scope fallback,
   * without paying to mount their content on restart.
   */
  restoredTitle?: string
  /**
   * The Favorites row this tab was opened from: its label, and the app path it
   * opened to. While the tab sits on that path the strip shows this name
   * instead of the page's own, so a favorite and the tab it produces are
   * recognisably the same thing. Not persisted — a restored tab names itself.
   */
  favoriteTitle?: { title: string; href: string } | null
}

export const LAST_TEAM_STORAGE_KEY = 'nuphos.workspace.lastTeamId'
/**
 * The workspace dock's tab strip (this file's `WorkspaceTabState[]`) is
 * scoped per chat session (the selected session id) rather than shared across
 * the whole workspace — see `workspace/store/`. `NO_SESSION_TAB_BUCKET_KEY`
 * is the bucket for dock tabs opened with no agent conversation selected.
 */
export const NO_SESSION_TAB_BUCKET_KEY = '__no-session__'
/** Soft cap on how many sessions' dock tab state stays resident in memory and
 *  on disk. Only sessions where the user actually opened a dock tab ever get
 *  an entry, so this bounds worst-case growth, not typical usage. */
export const MAX_RESIDENT_SESSION_TAB_BUCKETS = 20
export const WORKSPACE_TABS_STORAGE_KEY = 'nuphos.workspace.tabs.bySession.v2'
/** Pre-per-session format: one global tab strip, not associated with any
 *  chat session. Read once, on first launch after upgrade, to seed
 *  `NO_SESSION_TAB_BUCKET_KEY` — see `readPersistedWorkspaceBySession`. */
export const LEGACY_WORKSPACE_TABS_STORAGE_KEY = 'nuphos.workspace.tabs.v1'
// One frozen empty array for every "no rows yet" prop. A fresh `[]` per render
// is a new identity, which alone is enough to defeat the memo below.
export const EMPTY_LIST: never[] = []
export const CLUSTER_NAMESPACE_STORAGE_PREFIX = 'nuphos.k8s.lastNamespace.'
