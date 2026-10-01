import type { Scope } from '../types'

/**
 * The parent of the section list currently shown in the sidebar — one step up
 * the navigation hierarchy. Drives the sidebar's "← Back" affordance and, via
 * the lower level, the reverse slide. Returns null at the team root (top level).
 */
export function sidebarBackTarget(
  scope: Scope,
  active: string,
  grafanaInstance: { id: string; name: string; url: string } | null | undefined,
  repositoryNav: { repoName: string; tab: 'prs' | 'actions' } | undefined,
): { scope: Scope; active: string } | null {
  if (scope.kind === 'team') {
    const inRepo = active.startsWith('github.') && !!repositoryNav
    const inGrafana =
      !!grafanaInstance &&
      (active === 'observability.dashboards' ||
        active === 'observability.alerts' ||
        active === 'observability.datasources')

    if (inGrafana) {
      // Back goes to the team home (agent), not the legacy observability
      // instance-picker page — that page only exists as a no-instance
      // fallback and is no longer part of the nav flow.
      return {
        scope: { kind: 'team', teamId: scope.teamId },
        active: 'team.agent',
      }
    }
    if (inRepo) {
      return {
        scope: { kind: 'team', teamId: scope.teamId },
        active: 'team.agent',
      }
    }

    return null
  }
  switch (scope.kind) {
    // Top-level integration scopes back out to the team home — users reach
    // them from the sidebar, not the integrations settings page.
    case 'aws-account':
    case 'gcp-project':
    case 'cloudflare-account':
    case 'linode-account':
    case 'hetzner-account':
    case 'tencent-account':
    case 'aliyun-account':
    case 'volcengine-account':
    case 'azure-subscription':
    case 'betterstack-integration':
    case 'uptime-kuma-instance':
    case 'database-connection':
    case 'compliance-integration':
    case 'tailscale-client':
    case 'zeabur-provider':
      return {
        scope: { kind: 'team', teamId: scope.teamId },
        active: 'team.agent',
      }
    case 'aws-ecs-cluster':
      return {
        scope: {
          kind: 'aws-account',
          teamId: scope.teamId,
          accountId: scope.accountId,
          roleId: scope.roleId,
        },
        active: 'aws.ecs',
      }
    case 'cloudflare-zone':
      return {
        scope: {
          kind: 'cloudflare-account',
          teamId: scope.teamId,
          accountId: scope.accountId,
        },
        active: 'cloudflare.zones',
      }
    case 'cluster':
      if (scope.parentKind === 'onprem-cluster') {
        return {
          scope: { kind: 'team', teamId: scope.teamId },
          active: 'team.integrations',
        }
      }
      if (scope.parentKind === 'aws-account') {
        return {
          scope: {
            kind: 'aws-account',
            teamId: scope.teamId,
            accountId: scope.parentId,
            roleId: scope.roleId,
          },
          active: 'aws.clusters',
        }
      }
      if (scope.parentKind === 'gcp-project') {
        return {
          scope: {
            kind: 'gcp-project',
            teamId: scope.teamId,
            projectId: scope.parentId,
            serviceAccountId: scope.serviceAccountId,
          },
          active: 'gcp.clusters',
        }
      }
      if (scope.parentKind === 'tencent-account') {
        return {
          scope: {
            kind: 'tencent-account',
            teamId: scope.teamId,
            accountId: scope.parentId,
          },
          active: 'tencent.clusters',
        }
      }
      if (scope.parentKind === 'aliyun-account') {
        return {
          scope: {
            kind: 'aliyun-account',
            teamId: scope.teamId,
            accountId: scope.parentId,
          },
          active: 'aliyun.clusters',
        }
      }
      if (scope.parentKind === 'volcengine-account') {
        return {
          scope: {
            kind: 'volcengine-account',
            teamId: scope.teamId,
            accountId: scope.parentId,
          },
          active: 'volcengine.clusters',
        }
      }

      return {
        scope: {
          kind: 'linode-account',
          teamId: scope.teamId,
          accountId: scope.parentId,
        },
        active: 'linode.lke',
      }
  }

  return null
}
