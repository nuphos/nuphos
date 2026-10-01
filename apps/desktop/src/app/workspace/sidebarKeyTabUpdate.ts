import { sidebarIntegrationTabUpdate } from './sidebarIntegrationUpdate'

import type {
  GithubInstallation,
  GitlabBinding,
  GitlabBindingNamespaces,
  GrafanaInstance,
} from '../../types'
import type { WorkspaceTabState } from '../workspaceTabState'

export type SidebarTeamMaps = {
  grafanaInstancesByTeam: Record<string, GrafanaInstance[] | undefined>
  githubInstallationsByTeam: Record<string, GithubInstallation[] | undefined>
  gitlabBindingsByTeam: Record<string, GitlabBinding[] | undefined>
  gitlabNamespacesByTeam: Record<string, GitlabBindingNamespaces[] | undefined>
}

export function sidebarKeyTabUpdate(
  key: string,
  tab: WorkspaceTabState,
  maps: SidebarTeamMaps,
): WorkspaceTabState {
  const sessionMatch = /^agent-session:(.+)$/.exec(key)

  if (sessionMatch) {
    return {
      ...tab,
      scope: { kind: 'team', teamId: tab.scope.teamId },
      active: 'team.agent',
      agentSessionId: sessionMatch[1],
      connectorDetail: null,
      triggerDetail: null,
      triggerForm: null,
      target: null,
      dashboardTarget: null,
      traceDatasourceTarget: null,
      logDatasourceTarget: null,
      grafanaInstance: null,
      filter: '',
      count: 0,
      sshTerminal: null,
    }
  }
  const integrationMatch =
    /^integration:(aws|gcp|gcp-monitoring|azure|cloudflare|linode|hetzner|tencent|aliyun|volcengine|betterstack|uptime-kuma|secureframe|vanta|tailscale|zeabur|grafana|github|gitlab|mongodb):(.+)$/.exec(
      key,
    )

  if (integrationMatch) {
    const [, provider, id] = integrationMatch

    return sidebarIntegrationTabUpdate(provider, id, tab, maps)
  }

  if ((key === 'github.prs' || key === 'github.actions') && tab.githubNav.view === 'repo') {
    return {
      ...tab,
      active: 'team.repository',
      githubNav: {
        ...tab.githubNav,
        tab: key === 'github.prs' ? 'prs' : 'actions',
      },
      target: null,
      filter: '',
      count: 0,
      sshTerminal: null,
    }
  }

  // Any team-level destination picked while inside a provider scope (e.g.
  // the team sidebar shown on connector-settings drill-downs) must back the
  // tab out to the team scope, or ScopeContent renders the wrong branch.
  if (key.startsWith('team.') && tab.scope.kind !== 'team') {
    return {
      ...tab,
      scope: { kind: 'team', teamId: tab.scope.teamId },
      active: key === 'team.accounts' ? 'team.integrations' : key,
      agentSessionId: key === 'team.agent' ? null : tab.agentSessionId,
      connectorDetail: null,
      triggerDetail: null,
      triggerForm: null,
      nuphosDashboard: null,
      target: null,
      dashboardTarget: null,
      traceDatasourceTarget: null,
      logDatasourceTarget: null,
      grafanaInstance: null,
      filter: '',
      count: 0,
      sshTerminal: null,
    }
  }

  return {
    ...tab,
    active: key,
    // The left "Agent" item always means "go to Agent Home" — clear any
    // open conversation so clicking it never silently reopens the last
    // chat. Other destinations keep agentSessionId untouched.
    agentSessionId: key === 'team.agent' ? null : tab.agentSessionId,
    // Sidebar picks land on the section root — drop any open connector
    // basic-info drill-down, any open dashboard so Dashboards shows
    // its list page, and any open trigger or Triggers form so clicking
    // Triggers means the list rather than wherever you last were.
    connectorDetail: null,
    triggerDetail: null,
    triggerForm: null,
    nuphosDashboard: null,
    target: null,
    dashboardTarget: key === 'observability.dashboards' ? tab.dashboardTarget : null,
    traceDatasourceTarget: null,
    logDatasourceTarget: null,
    grafanaInstance:
      key === 'observability.dashboards' ||
      key === 'observability.alerts' ||
      key === 'observability.datasources'
        ? tab.grafanaInstance
        : null,
    filter: '',
    count: 0,
    sshTerminal: null,
  }
}
