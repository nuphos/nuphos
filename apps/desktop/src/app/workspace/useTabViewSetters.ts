import { useCallback } from 'react'

import type { UpdateWorkspaceTab } from './paneTypes'
import type { DatasourceSummary } from '../../grafana/client'
import type { RepoProvider } from '../../lib/appRoutes'
import type { GithubNavState } from '../../views/GithubView'
import type { GitlabNavState } from '../../views/gitlabNav'

export function useTabViewSetters(tabId: string, updateTab: UpdateWorkspaceTab) {
  const setGrafanaInstance = useCallback(
    (grafanaInstance: { id: string; name: string; url: string } | null) => {
      updateTab(tabId, (cur) =>
        cur.grafanaInstance === grafanaInstance ? cur : { ...cur, grafanaInstance },
      )
    },
    [tabId, updateTab],
  )
  const setDashboardTarget = useCallback(
    (dashboardTarget: { uid: string; title: string; folderTitle?: string } | null) => {
      updateTab(tabId, (cur) =>
        cur.dashboardTarget === dashboardTarget ? cur : { ...cur, dashboardTarget },
      )
    },
    [tabId, updateTab],
  )
  const setTraceDatasourceTarget = useCallback(
    (traceDatasourceTarget: DatasourceSummary | null) => {
      updateTab(tabId, (cur) =>
        cur.traceDatasourceTarget === traceDatasourceTarget
          ? cur
          : { ...cur, traceDatasourceTarget },
      )
    },
    [tabId, updateTab],
  )
  const setLogDatasourceTarget = useCallback(
    (logDatasourceTarget: DatasourceSummary | null) => {
      updateTab(tabId, (cur) =>
        cur.logDatasourceTarget === logDatasourceTarget ? cur : { ...cur, logDatasourceTarget },
      )
    },
    [tabId, updateTab],
  )
  const setGithubNav = useCallback(
    (githubNav: GithubNavState) => {
      updateTab(tabId, (cur) => (cur.githubNav === githubNav ? cur : { ...cur, githubNav }))
    },
    [tabId, updateTab],
  )
  const setRepoProvider = useCallback(
    (repoProvider: RepoProvider) => {
      updateTab(tabId, (cur) =>
        cur.repoProvider === repoProvider ? cur : { ...cur, repoProvider },
      )
    },
    [tabId, updateTab],
  )
  const setGitlabNav = useCallback(
    (gitlabNav: GitlabNavState) => {
      updateTab(tabId, (cur) => (cur.gitlabNav === gitlabNav ? cur : { ...cur, gitlabNav }))
    },
    [tabId, updateTab],
  )
  const onSelectActive = useCallback(
    // `filter` lets callers deep-link to a list pre-narrowed to a query (e.g.
    // the Cluster Overview jumping to Pods + `status=Running`). Defaults to
    // clearing the filter, matching plain nav-item clicks.
    (key: string, filter = '') => {
      updateTab(tabId, (cur) => ({
        ...cur,
        active: key,
        target: null,
        // Section-root nav: Dashboards always lands on its list page.
        nuphosDashboard: null,
        dashboardTarget: key === 'observability.dashboards' ? cur.dashboardTarget : null,
        traceDatasourceTarget: null,
        logDatasourceTarget: null,
        grafanaInstance:
          key === 'observability.dashboards' ||
          key === 'observability.alerts' ||
          key === 'observability.datasources'
            ? cur.grafanaInstance
            : null,
        filter,
        count: 0,
      }))
    },
    [tabId, updateTab],
  )
  const onCount = useCallback(
    (count: number) => {
      updateTab(tabId, (cur) => (cur.count === count ? cur : { ...cur, count }))
    },
    [tabId, updateTab],
  )
  const onLoading = useCallback(
    (viewLoading: boolean) => {
      updateTab(tabId, (cur) => (cur.viewLoading === viewLoading ? cur : { ...cur, viewLoading }))
    },
    [tabId, updateTab],
  )
  const onAccountsChanged = useCallback(() => {
    // Stale-while-revalidate: keep the cached rows on screen and let the
    // refreshKey-driven refetch swap them atomically when it lands. Dropping
    // the cache here used to blank the whole integrations list and let each
    // provider trickle back in separately.
    updateTab(tabId, (cur) => ({ ...cur, refreshKey: cur.refreshKey + 1 }))
  }, [tabId, updateTab])

  return {
    setGrafanaInstance,
    setDashboardTarget,
    setTraceDatasourceTarget,
    setLogDatasourceTarget,
    setGithubNav,
    setRepoProvider,
    setGitlabNav,
    onSelectActive,
    onCount,
    onLoading,
    onAccountsChanged,
  }
}
