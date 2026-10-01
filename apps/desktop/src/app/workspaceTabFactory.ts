import {
  DEFAULT_GITHUB_NAV,
  DEFAULT_REPO_PROVIDER,
  pageLocationForNavigation,
} from '../lib/appRoutes.ts'
import { clusterConnectionKey } from '../lib/clusterConnectionIdentity.ts'
import { inheritNavigation } from '../lib/navHistory.ts'

import type { WorkspaceTabState } from './workspaceTabState'
import type { NavigationSnapshot, PageLocation } from '../lib/appRoutes'
import type { NavHistory } from '../lib/navHistory'

let fallbackTabIdSeq = 1
let tabSeq = 0

/** Next value for `WorkspaceTabState.createdSeq` — monotonic for this run. */
export function nextCreatedSeq(): number {
  tabSeq += 1

  return tabSeq
}

export function createTabId(): string {
  if (globalThis.crypto?.randomUUID) return `tab-${globalThis.crypto.randomUUID()}`

  return `tab-${Date.now().toString(36)}-${String(fallbackTabIdSeq++)}`
}

export function createWorkspaceTab(teamId: string): WorkspaceTabState {
  const navigation: NavigationSnapshot = {
    scope: { kind: 'team', teamId },
    active: 'team.new-tab',
    target: null,
    grafanaInstance: null,
    dashboardTarget: null,
    traceDatasourceTarget: null,
    logDatasourceTarget: null,
    githubNav: DEFAULT_GITHUB_NAV,
    repoProvider: DEFAULT_REPO_PROVIDER,
    agentSessionId: null,
    s3Detail: null,
  }

  return {
    id: createTabId(),
    createdSeq: nextCreatedSeq(),
    scope: navigation.scope,
    active: navigation.active,
    filter: '',
    refreshKey: 0,
    pollTick: 0,
    count: 0,
    viewLoading: false,
    target: navigation.target,
    grafanaInstance: navigation.grafanaInstance,
    dashboardTarget: navigation.dashboardTarget,
    traceDatasourceTarget: navigation.traceDatasourceTarget,
    logDatasourceTarget: navigation.logDatasourceTarget,
    githubNav: navigation.githubNav,
    gitlabNav: navigation.gitlabNav,
    repoProvider: navigation.repoProvider,
    s3Detail: navigation.s3Detail,
    namespaces: [],
    switching: false,
    clusterLabel: null,
    kubeconfigContext: null,
    kubeconfigContextError: null,
    sshTerminal: null,
    pageMeta: null,
    navHistory: [navigation],
    navHistoryIndex: 0,
    agentSessionId: null,
  }
}

export function createWorkspaceTabFromNavigation(
  navigation: NavigationSnapshot,
): WorkspaceTabState {
  const tab = createWorkspaceTab(navigation.scope.teamId)

  return {
    ...tab,
    scope: navigation.scope,
    active: navigation.active,
    filter: navigation.filter ?? '',
    browserUrl: navigation.browserUrl,
    target: navigation.target,
    grafanaInstance: navigation.grafanaInstance,
    dashboardTarget: navigation.dashboardTarget,
    traceDatasourceTarget: navigation.traceDatasourceTarget,
    logDatasourceTarget: navigation.logDatasourceTarget,
    githubNav: navigation.githubNav,
    gitlabNav: navigation.gitlabNav,
    agentSessionId: navigation.agentSessionId,
    s3Detail: navigation.s3Detail,
    awsDetail: navigation.awsDetail ?? null,
    architectureDetail: navigation.architectureDetail ?? null,
    nuphosDashboard: navigation.nuphosDashboard ?? null,
    linearNav: navigation.linearNav ?? null,
    cloudflareDetail: navigation.cloudflareDetail ?? null,
    connectorDetail: navigation.connectorDetail ?? null,
    addIntegrationOpen: navigation.addIntegrationOpen ?? false,
    navHistory: [navigation],
    navHistoryIndex: 0,
  }
}

export function retargetWorkspaceTabToNavigation(
  tab: WorkspaceTabState,
  navigation: NavigationSnapshot,
): WorkspaceTabState {
  return {
    ...tab,
    scope: navigation.scope,
    active: navigation.active,
    filter: navigation.filter ?? '',
    browserUrl: navigation.browserUrl,
    target: navigation.target,
    grafanaInstance: navigation.grafanaInstance,
    dashboardTarget: navigation.dashboardTarget,
    traceDatasourceTarget: navigation.traceDatasourceTarget,
    logDatasourceTarget: navigation.logDatasourceTarget,
    githubNav: navigation.githubNav,
    gitlabNav: navigation.gitlabNav,
    agentSessionId: navigation.agentSessionId,
    s3Detail: navigation.s3Detail,
    awsDetail: navigation.awsDetail ?? null,
    architectureDetail: navigation.architectureDetail ?? null,
    nuphosDashboard: navigation.nuphosDashboard ?? null,
    linearNav: navigation.linearNav ?? null,
    // Retargeting may cross teams — drop the cached list; the view re-reports.
    nuphosDashboards: undefined,
    cloudflareDetail: navigation.cloudflareDetail ?? null,
    connectorDetail: navigation.connectorDetail ?? null,
    addIntegrationOpen: navigation.addIntegrationOpen ?? false,
    count: 0,
    viewLoading: false,
    switching: false,
    clusterLabel: null,
    kubeconfigContext: null,
    kubeconfigContextError: null,
    sshTerminal: null,
    pageMeta: null,
    // Deliberately NOT resetting navHistory: retargeting happens *inside* an
    // existing tab (a favourite, a deep link landing on an open tab), so it is
    // a navigation like any other and `updateTab` records it. Wiping the stack
    // here left Back greyed out on the very move the user just made.
  }
}

export function isFreshTeamTab(tab: WorkspaceTabState): boolean {
  return (
    tab.scope.kind === 'team' &&
    tab.active === 'team.new-tab' &&
    tab.target === null &&
    tab.grafanaInstance === null &&
    tab.dashboardTarget === null &&
    tab.traceDatasourceTarget === null &&
    tab.logDatasourceTarget === null &&
    tab.githubNav.view === DEFAULT_GITHUB_NAV.view &&
    tab.agentSessionId === null &&
    tab.s3Detail === null &&
    (tab.awsDetail ?? null) === null &&
    (tab.cloudflareDetail ?? null) === null &&
    (tab.linearNav ?? null) === null &&
    tab.sshTerminal === null &&
    tab.filter === '' &&
    tab.navHistory.length === 1 &&
    tab.navHistoryIndex === 0
  )
}

export function pageLocationForTab(tab: WorkspaceTabState): PageLocation {
  return pageLocationForNavigation(navigationSnapshot(tab), tab)
}

export function navigationSnapshot(tab: WorkspaceTabState): NavigationSnapshot {
  return {
    scope: tab.scope,
    active: tab.active,
    filter: tab.filter,
    browserUrl: tab.browserUrl,
    target: tab.target,
    grafanaInstance: tab.grafanaInstance,
    dashboardTarget: tab.dashboardTarget,
    traceDatasourceTarget: tab.traceDatasourceTarget,
    logDatasourceTarget: tab.logDatasourceTarget,
    githubNav: tab.githubNav,
    gitlabNav: tab.gitlabNav,
    repoProvider: tab.repoProvider,
    agentSessionId: tab.agentSessionId,
    s3Detail: tab.s3Detail,
    awsDetail: tab.awsDetail ?? null,
    architectureDetail: tab.architectureDetail ?? null,
    nuphosDashboard: tab.nuphosDashboard ?? null,
    linearNav: tab.linearNav ?? null,
    cloudflareDetail: tab.cloudflareDetail ?? null,
    connectorDetail: tab.connectorDetail ?? null,
    addIntegrationOpen: tab.addIntegrationOpen ?? false,
  }
}

export function restoreNavigation(
  tab: WorkspaceTabState,
  snapshot: NavigationSnapshot,
  index: number,
): WorkspaceTabState {
  const connectionKey = clusterConnectionKey(tab.scope)
  const keepConnection =
    Boolean(tab.kubeconfigContext) &&
    connectionKey !== null &&
    connectionKey === clusterConnectionKey(snapshot.scope)

  return {
    ...tab,
    ...snapshot,
    navHistoryIndex: index,
    target: snapshot.target,
    s3Detail: snapshot.s3Detail,
    awsDetail: snapshot.awsDetail ?? null,
    architectureDetail: snapshot.architectureDetail ?? null,
    nuphosDashboard: snapshot.nuphosDashboard ?? null,
    linearNav: snapshot.linearNav ?? null,
    cloudflareDetail: snapshot.cloudflareDetail ?? null,
    connectorDetail: snapshot.connectorDetail ?? null,
    filter: snapshot.filter ?? '',
    browserUrl: snapshot.browserUrl,
    count: 0,
    viewLoading: false,
    switching: false,
    clusterLabel: keepConnection ? tab.clusterLabel : null,
    kubeconfigContext: keepConnection ? tab.kubeconfigContext : null,
    kubeconfigContextError: null,
    sshTerminal: null,
    pageMeta: null,
  }
}

/**
 * A tab opened from another tab starts with the source tab's back stack, so
 * Back returns to the page the user opened it from instead of dead-ending on a
 * one-entry history. SSH terminals have no page history to inherit.
 */
export function tabOpenedFrom(
  source: WorkspaceTabState | null | undefined,
  tab: WorkspaceTabState,
): WorkspaceTabState {
  // Callers build the tab in two steps — a factory seeds the history, then they
  // spread the session on top — so even with nothing to inherit the seeded
  // entry has to be replaced with what the tab actually shows. Persisting
  // before the first updateTab would otherwise restore a tab to Agent Home
  // instead of its conversation.
  const own: NavHistory = { navHistory: [navigationSnapshot(tab)], navHistoryIndex: 0 }

  if (!source || source.sshTerminal) return { ...tab, ...own }

  // The team rule lives in inheritNavigation: a source tab's stack can hold
  // entries from a team it has since been retargeted away from, so "same team"
  // has to be decided per entry, not per tab.
  return { ...tab, ...inheritNavigation(source, navigationSnapshot(tab)) }
}
