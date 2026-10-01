import { DEFAULT_GITHUB_NAV } from '../../lib/appRoutes'
import { DEFAULT_GITLAB_NAV } from '../../views/gitlabNav'

import type { Scope } from '../../types'
import type { GitlabNavState } from '../../views/gitlabNav'
import type { WorkspaceTabState } from '../workspaceTabState'
import type { SidebarTeamMaps } from './sidebarKeyTabUpdate'

export function sidebarIntegrationTabUpdate(
  provider: string,
  id: string,
  tab: WorkspaceTabState,
  maps: SidebarTeamMaps,
): WorkspaceTabState {
  const {
    grafanaInstancesByTeam,
    githubInstallationsByTeam,
    gitlabBindingsByTeam,
    gitlabNamespacesByTeam,
  } = maps

  if (provider === 'grafana') {
    const instance = grafanaInstancesByTeam[tab.scope.teamId]?.find((item) => item.id === id)

    if (!instance) return tab

    return {
      ...tab,
      scope: { kind: 'team', teamId: tab.scope.teamId },
      active: 'observability.dashboards',
      grafanaInstance: {
        id: instance.id,
        name: instance.name,
        url: instance.grafanaUrl,
      },
      dashboardTarget: null,
      traceDatasourceTarget: null,
      logDatasourceTarget: null,
      githubNav: DEFAULT_GITHUB_NAV,
      target: null,
      filter: '',
      count: 0,
      sshTerminal: null,
    }
  }
  if (provider === 'gitlab') {
    // id is either "<bindingId>" (fallback item) or
    // "<bindingId>:<namespaceFullPath>" (a flattened namespace).
    const [bindingId, ...nsParts] = id.split(':')
    const nsPath = nsParts.join(':')
    const binding = gitlabBindingsByTeam[tab.scope.teamId]?.find((b) => b.id === bindingId)
    const namespace = nsPath
      ? gitlabNamespacesByTeam[tab.scope.teamId]
          ?.find((entry) => entry.bindingId === bindingId)
          ?.namespaces.find((ns) => ns.fullPath === nsPath)
      : undefined
    const gitlabNav: GitlabNavState =
      binding && namespace ? { view: 'projects', binding, namespace } : DEFAULT_GITLAB_NAV

    return {
      ...tab,
      scope: { kind: 'team', teamId: tab.scope.teamId },
      active: 'team.repository',
      repoProvider: 'gitlab',
      gitlabNav,
      githubNav: DEFAULT_GITHUB_NAV,
      grafanaInstance: null,
      dashboardTarget: null,
      traceDatasourceTarget: null,
      logDatasourceTarget: null,
      target: null,
      filter: '',
      count: 0,
      sshTerminal: null,
    }
  }
  if (provider === 'github') {
    const installation = githubInstallationsByTeam[tab.scope.teamId]?.find(
      (item) => String(item.installationId) === id,
    )

    if (!installation) return tab

    return {
      ...tab,
      scope: { kind: 'team', teamId: tab.scope.teamId },
      active: 'team.repository',
      repoProvider: 'github',
      githubNav: { view: 'repos', installation },
      grafanaInstance: null,
      dashboardTarget: null,
      traceDatasourceTarget: null,
      logDatasourceTarget: null,
      target: null,
      filter: '',
      count: 0,
      sshTerminal: null,
    }
  }
  const next: { scope: Scope; active: string } =
    provider === 'aws'
      ? {
          scope: { kind: 'aws-account' as const, teamId: tab.scope.teamId, accountId: id },
          active: 'aws.clusters',
        }
      : provider === 'gcp'
        ? {
            scope: {
              kind: 'gcp-project' as const,
              teamId: tab.scope.teamId,
              projectId: id,
            },
            active: 'gcp.clusters',
          }
        : provider === 'gcp-monitoring'
          ? {
              scope: {
                kind: 'gcp-project' as const,
                teamId: tab.scope.teamId,
                projectId: id,
              },
              active: 'gcp.metrics',
            }
          : provider === 'cloudflare'
            ? {
                scope: {
                  kind: 'cloudflare-account' as const,
                  teamId: tab.scope.teamId,
                  accountId: id,
                },
                active: 'cloudflare.zones',
              }
            : provider === 'linode'
              ? {
                  scope: {
                    kind: 'linode-account' as const,
                    teamId: tab.scope.teamId,
                    accountId: id,
                  },
                  active: 'linode.instances',
                }
              : provider === 'hetzner'
                ? {
                    scope: {
                      kind: 'hetzner-account' as const,
                      teamId: tab.scope.teamId,
                      accountId: id,
                    },
                    active: 'hetzner.servers',
                  }
                : provider === 'betterstack'
                  ? {
                      scope: {
                        kind: 'betterstack-integration' as const,
                        teamId: tab.scope.teamId,
                        integrationId: id,
                      },
                      active: 'betterstack.monitors',
                    }
                  : provider === 'uptime-kuma'
                    ? {
                        scope: {
                          kind: 'uptime-kuma-instance' as const,
                          teamId: tab.scope.teamId,
                          instanceId: id,
                        },
                        active: 'uptime-kuma.monitors',
                      }
                    : provider === 'mongodb'
                      ? {
                          scope: {
                            kind: 'database-connection' as const,
                            teamId: tab.scope.teamId,
                            connectionId: id,
                          },
                          active: 'database.overview',
                        }
                      : provider === 'secureframe' || provider === 'vanta'
                        ? {
                            scope: {
                              kind: 'compliance-integration' as const,
                              teamId: tab.scope.teamId,
                              provider,
                              integrationId: id,
                            },
                            active: 'compliance.tests',
                          }
                        : provider === 'tailscale'
                          ? {
                              scope: {
                                kind: 'tailscale-client' as const,
                                teamId: tab.scope.teamId,
                                clientId: id,
                              },
                              active: 'tailscale.devices',
                            }
                          : provider === 'tencent'
                            ? {
                                scope: {
                                  kind: 'tencent-account' as const,
                                  teamId: tab.scope.teamId,
                                  accountId: id,
                                },
                                active: 'tencent.clusters',
                              }
                            : provider === 'aliyun'
                              ? {
                                  scope: {
                                    kind: 'aliyun-account' as const,
                                    teamId: tab.scope.teamId,
                                    accountId: id,
                                  },
                                  active: 'aliyun.clusters',
                                }
                              : provider === 'volcengine'
                                ? {
                                    scope: {
                                      kind: 'volcengine-account' as const,
                                      teamId: tab.scope.teamId,
                                      accountId: id,
                                    },
                                    active: 'volcengine.clusters',
                                  }
                                : provider === 'azure'
                                  ? {
                                      scope: {
                                        kind: 'azure-subscription' as const,
                                        teamId: tab.scope.teamId,
                                        subscriptionId: id,
                                      },
                                      active: 'azure.apps',
                                    }
                                  : {
                                      scope: {
                                        kind: 'zeabur-provider' as const,
                                        teamId: tab.scope.teamId,
                                        zeaburId: id,
                                      },
                                      active: 'zeabur.projects',
                                    }

  return {
    ...tab,
    scope: next.scope,
    active: next.active,
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
