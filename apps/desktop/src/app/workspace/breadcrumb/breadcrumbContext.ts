import type { BreadcrumbSegment } from '../../../components/Toolbar'
import type { DatasourceSummary } from '../../../grafana/client'
import type {
  AwsResourceDetailRef,
  AwsS3Detail,
  CloudflareResourceDetailRef,
  ConnectorDetailRef,
  LinearNavState,
  NuphosDashboardRef,
  RepoProvider,
  TriggerFormRef,
} from '../../../lib/appRoutes'
import type { KubernetesClusterSelection } from '../../../lib/kubernetesCluster'
import type {
  AtlasCluster,
  AtlasTeam,
  AwsEc2Instance,
  AwsLightsailInstance,
  DatabaseConnection,
  GcpComputeInstance,
  GrafanaInstance,
  LkeCluster,
  Scope,
} from '../../../types'
import type { DetailTarget } from '../../../views/DetailView'
import type { GithubNavState } from '../../../views/GithubView'
import type { AccountSet, SshTerminalTabState, WorkspaceTabState } from '../../workspaceTabState'

export type BreadcrumbContext = {
  scope: Scope
  active: string
  filter: string
  target: DetailTarget | null
  s3Detail: AwsS3Detail | null
  architectureDetail: { diagramId: string; diagramName: string } | null
  nuphosDashboard: NuphosDashboardRef | null
  nuphosDashboards: { id: string; name: string }[] | undefined
  connectorDetail: ConnectorDetailRef | null
  triggerDetail: { triggerId: string; triggerName: string } | null
  triggerForm: TriggerFormRef | null
  agentSessionTitle: string | null
  agentSessionId: string | null
  awsDetail: AwsResourceDetailRef | null
  cloudflareDetail: CloudflareResourceDetailRef | null
  updateActiveTab: (updater: (tab: WorkspaceTabState) => WorkspaceTabState) => void
  teams: AtlasTeam[]
  accounts: AccountSet | undefined
  clusterLabel: string | null
  enterScope: (next: Scope, defaultActive?: string) => void
  switchTeam: (nextTeamId: string) => void
  enterCluster: (params: KubernetesClusterSelection & { tabId?: string }) => void
  clustersByParent: Record<string, AtlasCluster[] | undefined>
  lkeClustersByAccount: Record<string, LkeCluster[] | undefined>
  loadLkeClustersForAccount: (teamId: string, accountId: string) => void
  refreshTeamsSilently: () => void
  grafanaInstance: { id: string; name: string; url: string } | null
  dashboardTarget: { uid: string; title: string; folderTitle?: string } | null
  traceDatasourceTarget: DatasourceSummary | null
  logDatasourceTarget: DatasourceSummary | null
  githubNav: GithubNavState
  linearNav?: LinearNavState | null
  repoProvider: RepoProvider
  grafanaInstancesByTeam: Record<string, GrafanaInstance[] | undefined>
  onSidebarSelect: (key: string) => void
  sshTerminal: SshTerminalTabState | null
  ec2InstancesByAccount: Record<string, AwsEc2Instance[] | undefined>
  lightsailInstancesByAccount: Record<string, AwsLightsailInstance[] | undefined>
  gceInstancesByProject: Record<string, GcpComputeInstance[] | undefined>
  loadEc2InstancesForAccount: (teamId: string, accountId: string) => void
  loadLightsailInstancesForAccount: (teamId: string, accountId: string) => void
  loadGceInstancesForProject: (teamId: string, projectId: string) => void
  openEc2SshTab: (params: {
    teamId: string
    accountId: string
    roleId?: string
    instance: AwsEc2Instance
  }) => void
  openLightsailSshTab: (params: {
    teamId: string
    accountId: string
    roleId?: string
    instance: AwsLightsailInstance
  }) => void
  openGceSshTab: (params: {
    teamId: string
    projectId: string
    serviceAccountId?: string
    instance: GcpComputeInstance
  }) => void
  databaseConnectionsByTeam: Record<string, DatabaseConnection[] | undefined>
}

/** A section pushes its crumbs into `out`; returning true ends the trail. */
export type BreadcrumbSection = (ctx: BreadcrumbContext, out: BreadcrumbSegment[]) => boolean | void
