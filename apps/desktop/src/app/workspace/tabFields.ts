import { DEFAULT_GITHUB_NAV, DEFAULT_REPO_PROVIDER } from '../../lib/appRoutes'

import type { RepoProvider } from '../../lib/appRoutes'
import type { WorkspaceTabState } from '../workspaceTabState'

/** What a page's toolbar and breadcrumb read off its tab. */
export function tabFields(tab: WorkspaceTabState | null) {
  const repoProvider: RepoProvider = tab?.repoProvider ?? DEFAULT_REPO_PROVIDER

  return {
    active: tab?.active ?? '',
    filter: tab?.filter ?? '',
    refreshKey: tab?.refreshKey ?? 0,
    count: tab?.count ?? 0,
    viewLoading: tab?.viewLoading ?? false,
    target: tab?.target ?? null,
    s3Detail: tab?.s3Detail ?? null,
    architectureDetail: tab?.architectureDetail ?? null,
    designDetail: tab?.designDetail ?? null,
    nuphosDashboard: tab?.nuphosDashboard ?? null,
    nuphosDashboards: tab?.nuphosDashboards,
    linearNav: tab?.linearNav ?? null,
    connectorDetail: tab?.connectorDetail ?? null,
    awsDetail: tab?.awsDetail ?? null,
    cloudflareDetail: tab?.cloudflareDetail ?? null,
    grafanaInstance: tab?.grafanaInstance ?? null,
    dashboardTarget: tab?.dashboardTarget ?? null,
    traceDatasourceTarget: tab?.traceDatasourceTarget ?? null,
    logDatasourceTarget: tab?.logDatasourceTarget ?? null,
    sshTerminal: tab?.sshTerminal ?? null,
    githubNav: tab?.githubNav ?? DEFAULT_GITHUB_NAV,
    repoProvider,
    namespaces: tab?.namespaces ?? [],
    switching: tab?.switching ?? false,
    clusterLabel: tab?.clusterLabel ?? null,
  }
}
