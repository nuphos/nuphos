import { Bell, Database, LayoutDashboard, MessageSquare } from 'lucide-react'

import { CloudLogo } from '../../components/CloudLogo'
import { GithubMark } from '../../components/GithubMark'
import { LinearMark } from '../../components/LinearMark'
import { DATABASE_NAV_LABELS, isDatabaseEngineReleased } from '../../lib/databaseRelease'
import { LINEAR_PAGE_KEY, linearNavOf, linearPageTitle } from '../../lib/linearNav'
import { DatabaseConnectionsView } from '../../views/DatabaseConnectionsView'
import { GithubView } from '../../views/GithubView'
import { GitlabView } from '../../views/GitlabView'
import { GrafanaAlertListView } from '../../views/GrafanaAlertListView'
import { GrafanaDashboardListView } from '../../views/GrafanaDashboardListView'
import { GrafanaDashboardView } from '../../views/GrafanaDashboardView'
import { GrafanaDatasourceListView } from '../../views/GrafanaDatasourceListView'
import { GrafanaLogExplorerView } from '../../views/GrafanaLogExplorerView'
import { GrafanaTraceExplorerView } from '../../views/GrafanaTraceExplorerView'
import { LinearView } from '../../views/linear/LinearView'
import { ObservabilityHomeView } from '../../views/ObservabilityHomeView'

import type { ScopeRenderContext } from './context'

export function renderTeamPages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    active,
    currentUserId,
    filter,
    refreshKey,
    scopedDatabaseConnection,
    databaseConnections,
    grafanaInstance,
    setGrafanaInstance,
    dashboardTarget,
    setDashboardTarget,
    traceDatasourceTarget,
    logDatasourceTarget,
    setTraceDatasourceTarget,
    setLogDatasourceTarget,
    githubNav,
    setGithubNav,
    gitlabNav,
    setGitlabNav,
    linearNav,
    setLinearNav,
    repoProvider,
    onConnectGithub,
    onConnectGitlab,
    onSelectActive,
    onCount,
    onLoading,
    onExitToConnectors,
    onOpenAgentChat,
    onOpenPlanInChat,
    isTeamAdmin,
    renderPage,
    renderActiveNavPage,
  } = ctx

  if (scope.kind === 'database-connection') {
    const label = DATABASE_NAV_LABELS[active] ?? 'Overview'

    if (databaseConnections === undefined) {
      return renderActiveNavPage(
        label,
        <Database className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        null,
      )
    }
    if (!scopedDatabaseConnection || !isDatabaseEngineReleased(scopedDatabaseConnection.engine)) {
      return renderActiveNavPage(
        label,
        <Database className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        null,
      )
    }

    return renderActiveNavPage(
      label,
      <Database className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <DatabaseConnectionsView
        teamId={scope.teamId}
        currentUserId={currentUserId}
        connectionId={scope.connectionId}
        active={active}
        refreshKey={refreshKey}
        isTeamAdmin={isTeamAdmin}
        onChanged={() => window.dispatchEvent(new Event('nuphos:databases-changed'))}
        onLeave={onExitToConnectors}
        onOpenPlanInChat={onOpenPlanInChat}
      />,
    )
  }

  if (scope.kind === 'team' && active === 'team.agent') {
    return renderPage(
      'team.agent',
      'Agent',
      <MessageSquare className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      null,
    )
  }

  if (active === 'team.observability') {
    return renderPage(
      'team.observability',
      'Observability',
      <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ObservabilityHomeView
        teamId={scope.teamId}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onPick={(inst) => {
          setGrafanaInstance({ id: inst.id, name: inst.name, url: inst.grafanaUrl })
          onSelectActive('observability.dashboards')
        }}
      />,
    )
  }
  if (active === 'team.repository' && scope.kind === 'team') {
    if (repoProvider === 'gitlab') {
      const gitlabTitle =
        gitlabNav.view === 'project'
          ? gitlabNav.project.name
          : gitlabNav.view === 'projects'
            ? (gitlabNav.namespace?.name ?? `@${gitlabNav.binding.username}`)
            : 'GitLab'

      return renderPage(
        'team.repository',
        gitlabTitle,
        <CloudLogo provider="gitlab" size={14} />,
        <GitlabView
          key={scope.teamId}
          teamId={scope.teamId}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onConnectGitlab={onConnectGitlab}
          nav={gitlabNav}
          onNavChange={setGitlabNav}
        />,
      )
    }
    const repoTitle =
      githubNav.view === 'pull'
        ? `#${String(githubNav.prNumber)} ${githubNav.prTitle}`
        : githubNav.view === 'repo'
          ? githubNav.tab === 'prs'
            ? 'PRs'
            : 'Workflows'
          : githubNav.view === 'repos'
            ? githubNav.installation.accountLogin
            : 'Repository'

    return renderPage(
      'team.repository',
      repoTitle,
      <GithubMark size={14} className="text-tertiary" />,
      <GithubView
        key={scope.teamId}
        teamId={scope.teamId}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        nav={githubNav}
        onNavChange={setGithubNav}
        onConnectGithub={onConnectGithub}
      />,
    )
  }
  if (active === LINEAR_PAGE_KEY && scope.kind === 'team') {
    const nav = linearNavOf(linearNav)

    return renderPage(
      LINEAR_PAGE_KEY,
      linearPageTitle(nav),
      <LinearMark size={14} className="text-tertiary" />,
      <LinearView
        teamId={scope.teamId}
        nav={nav}
        onNavChange={setLinearNav}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onOpenConnectors={() => onSelectActive('team.integrations')}
      />,
    )
  }
  if (active === 'observability.dashboards') {
    if (!grafanaInstance) {
      // The effect above will redirect to the picker on the next tick.
      return null
    }
    const target = { teamId: scope.teamId, instanceId: grafanaInstance.id }

    if (dashboardTarget) {
      return renderPage(
        'observability.dashboard',
        dashboardTarget.title,
        <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <GrafanaDashboardView target={target} uid={dashboardTarget.uid} />,
      )
    }

    return renderPage(
      'observability.dashboards',
      'Dashboards',
      <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <GrafanaDashboardListView
        target={target}
        filter={filter}
        onCount={onCount}
        onSelect={(d) =>
          setDashboardTarget({
            uid: d.uid,
            title: d.title,
            folderTitle: d.folderTitle,
          })
        }
      />,
    )
  }
  if (active === 'observability.alerts') {
    if (!grafanaInstance) {
      return null
    }
    const target = { teamId: scope.teamId, instanceId: grafanaInstance.id }

    return renderPage(
      'observability.alerts',
      'Alerts',
      <Bell className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <GrafanaAlertListView target={target} filter={filter} onCount={onCount} />,
    )
  }
  if (active === 'observability.datasources') {
    if (!grafanaInstance) {
      return null
    }
    const target = { teamId: scope.teamId, instanceId: grafanaInstance.id }

    if (traceDatasourceTarget) {
      return renderPage(
        'observability.trace-explorer',
        'Trace Explorer',
        <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <GrafanaTraceExplorerView
          target={target}
          datasource={traceDatasourceTarget}
          onBack={() => setTraceDatasourceTarget(null)}
        />,
      )
    }
    if (logDatasourceTarget) {
      return renderPage(
        'observability.log-explorer',
        'Log Explorer',
        <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <GrafanaLogExplorerView
          target={target}
          datasource={logDatasourceTarget}
          onBack={() => setLogDatasourceTarget(null)}
          onOpenAgentChat={onOpenAgentChat}
        />,
      )
    }

    return renderPage(
      'observability.datasources',
      'Datasources',
      <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <GrafanaDatasourceListView
        target={target}
        filter={filter}
        onCount={onCount}
        onOpenTraceExplorer={setTraceDatasourceTarget}
        onOpenLogExplorer={setLogDatasourceTarget}
      />,
    )
  }

  return undefined
}
