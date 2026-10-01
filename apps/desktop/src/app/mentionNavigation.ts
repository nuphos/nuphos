// Runtime imports stay extension-explicit and React-free so this module loads
// under plain `node --test` (mentionNavigation.test.ts).
import {
  DEFAULT_GITHUB_NAV,
  DEFAULT_KEY,
  DEFAULT_REPO_PROVIDER,
  activeKeyForDetailKind,
  detailKindFromUrlSegment,
  githubInstallationFromId,
  githubRepositoryFromPath,
  navigationFromAppPath,
  pathSegment,
} from '../lib/appRoutes.ts'
import { customResourceNavigationKey } from '../lib/customResourceNavigation.ts'
import { clusterScopeFromRoute } from '../lib/kubernetesClusterRoutes.ts'

import type { NavigationSnapshot } from '../lib/appRoutes.ts'
import type { MentionTarget } from '../lib/atlasLinkMention.ts'
import type { Scope } from '../types.ts'

export function navigationFromMentionTarget(target: MentionTarget): NavigationSnapshot | null {
  const teamScope = { kind: 'team' as const, teamId: target.teamId }
  const base = (
    scope: Scope,
    active = DEFAULT_KEY[scope.kind],
    extra: Partial<NavigationSnapshot> = {},
  ): NavigationSnapshot => ({
    scope,
    active,
    target: null,
    grafanaInstance: null,
    dashboardTarget: null,
    traceDatasourceTarget: null,
    logDatasourceTarget: null,
    githubNav: DEFAULT_GITHUB_NAV,
    repoProvider: DEFAULT_REPO_PROVIDER,
    agentSessionId: null,
    s3Detail: null,
    ...extra,
  })

  switch (target.type) {
    case 'aws-account':
      return base({ kind: 'aws-account', teamId: target.teamId, accountId: target.accountId })
    case 'aws-vpc':
      return base(
        { kind: 'aws-account', teamId: target.teamId, accountId: target.accountId },
        'aws.vpcs',
        { filter: target.vpcId },
      )
    case 'aws-nacl':
      return base(
        { kind: 'aws-account', teamId: target.teamId, accountId: target.accountId },
        'aws.nacls',
        { filter: target.naclId },
      )
    case 'aws-ec2':
      return base(
        { kind: 'aws-account', teamId: target.teamId, accountId: target.accountId },
        'aws.ec2',
        { filter: target.instanceId },
      )
    case 'aws-lightsail':
      return base(
        { kind: 'aws-account', teamId: target.teamId, accountId: target.accountId },
        'aws.lightsail',
        { filter: target.name },
      )
    case 'aws-cfn':
      return base(
        { kind: 'aws-account', teamId: target.teamId, accountId: target.accountId },
        'aws.cloudformation',
        { filter: target.stackName },
      )
    case 'aws-ecs-cluster':
      return base({
        kind: 'aws-ecs-cluster',
        teamId: target.teamId,
        accountId: target.accountId,
        region: target.region,
        clusterName: target.clusterName,
        clusterArn: '',
      })
    case 'aws-s3': {
      const key = target.key.replace(/\/$/, '')
      const lastSlash = key.lastIndexOf('/')
      const objectPrefix = lastSlash >= 0 ? key.slice(0, lastSlash + 1) : ''
      const objectName = lastSlash >= 0 ? key.slice(lastSlash + 1) : key
      const prefix = target.kind === 'object' ? objectPrefix : target.key

      return base(
        { kind: 'aws-account', teamId: target.teamId, accountId: target.accountId },
        'aws.s3',
        {
          filter: target.kind === 'object' ? objectName : '',
          s3Detail: { bucket: target.bucket, region: '', prefix },
        },
      )
    }
    case 'gcp-project':
      return base({ kind: 'gcp-project', teamId: target.teamId, projectId: target.projectId })
    case 'gcp-vpc':
      return base(
        { kind: 'gcp-project', teamId: target.teamId, projectId: target.projectId },
        'gcp.vpcs',
        { filter: target.vpcId },
      )
    case 'gcp-firewall':
      return base(
        { kind: 'gcp-project', teamId: target.teamId, projectId: target.projectId },
        'gcp.firewalls',
        { filter: target.name },
      )
    case 'cloudflare-account':
      return base({
        kind: 'cloudflare-account',
        teamId: target.teamId,
        accountId: target.accountId,
      })
    case 'cloudflare-zone':
      return base({
        kind: 'cloudflare-zone',
        teamId: target.teamId,
        accountId: target.accountId,
        zoneId: target.zoneId,
        zoneName: target.zoneId,
      })
    case 'cloudflare-dns':
      return base(
        {
          kind: 'cloudflare-zone',
          teamId: target.teamId,
          accountId: target.accountId,
          zoneId: target.zoneId,
          zoneName: target.zoneId,
        },
        'cloudflare.dns',
        { filter: target.recordId },
      )
    case 'cluster': {
      const scope = clusterScopeFromRoute({
        teamId: target.teamId,
        provider: target.provider,
        connectionId: target.parentId,
        region: target.region,
        clusterId: target.clusterName,
      })

      return scope ? base(scope) : null
    }
    case 'k8s-resource': {
      const scope = clusterScopeFromRoute({
        teamId: target.teamId,
        provider: target.provider,
        connectionId: target.parentId,
        region: target.region,
        clusterId: target.clusterName,
      })

      if (!scope) return null

      if (target.apiVersion && target.plural && target.resourceKind) {
        return base(
          target.namespace === null ? scope : { ...scope, namespace: target.namespace },
          customResourceNavigationKey({
            apiVersion: target.apiVersion,
            kind: target.resourceKind,
            plural: target.plural,
            namespaced: target.namespace !== null,
          }),
          {
            target: {
              kind: 'CustomResource',
              namespace: target.namespace,
              name: target.name,
              apiVersion: target.apiVersion,
              plural: target.plural,
              resourceKind: target.resourceKind,
            },
          },
        )
      }

      const kind = detailKindFromUrlSegment(target.kind)

      if (!kind) return null

      return base(
        target.namespace === null ? scope : { ...scope, namespace: target.namespace },
        activeKeyForDetailKind(kind),
        { target: { kind, namespace: target.namespace, name: target.name } },
      )
    }
    case 'grafana-instance':
      return base(teamScope, 'observability.dashboards', {
        grafanaInstance: { id: target.instanceId, name: target.instanceId, url: '' },
      })
    case 'grafana-dashboard':
      return base(teamScope, 'observability.dashboards', {
        grafanaInstance: { id: target.instanceId, name: target.instanceId, url: '' },
        dashboardTarget: { uid: target.uid, title: target.uid },
      })
    case 'grafana-datasource':
      return base(teamScope, 'observability.datasources', {
        grafanaInstance: { id: target.instanceId, name: target.instanceId, url: '' },
        ...(target.traceExplorer
          ? { traceDatasourceTarget: { uid: target.uid, name: target.uid, type: 'tempo' } }
          : target.logExplorer
            ? { logDatasourceTarget: { uid: target.uid, name: target.uid, type: 'loki' } }
            : { filter: target.uid }),
      })
    case 'grafana-alert':
      return base(teamScope, 'observability.alerts', {
        grafanaInstance: { id: target.instanceId, name: target.instanceId, url: '' },
        filter: target.uid,
      })
    case 'monitoring-item':
      return base(teamScope, 'team.monitoring', {
        filter: target.resourceId,
      })
    case 'github-installation':
      return base(teamScope, 'team.repository', {
        githubNav: {
          view: 'repos',
          installation: githubInstallationFromId(target.installationId),
        },
      })
    case 'github-repo':
      return base(teamScope, 'team.repository', {
        githubNav: {
          view: 'repo',
          installation: githubInstallationFromId(target.installationId, target.owner),
          repo: githubRepositoryFromPath(target.owner, target.repo),
          tab: 'prs',
          prState: 'open',
        },
      })
    case 'github-pr': {
      const repoPath = `/teams/${pathSegment(target.teamId)}/repository/installations/${pathSegment(target.installationId)}/repos/${pathSegment(target.owner)}/${pathSegment(target.repo)}`
      const query = target.prState ? `?state=${target.prState}` : ''
      // The route table owns the PR page; a non-numeric segment is the list
      // searched for that text.
      const pullNavigation = /^\d+$/.test(target.number)
        ? navigationFromAppPath(`${repoPath}/pull-requests/${target.number}${query}`)
        : null

      return (
        pullNavigation ??
        base(teamScope, 'team.repository', {
          filter: target.number,
          githubNav: {
            view: 'repo',
            installation: githubInstallationFromId(target.installationId, target.owner),
            repo: githubRepositoryFromPath(target.owner, target.repo),
            tab: 'prs',
            prState: target.prState ?? 'all',
          },
        })
      )
    }
    case 'github-workflow-run':
      return base(teamScope, 'team.repository', {
        filter: target.runId,
        githubNav: {
          view: 'repo',
          installation: githubInstallationFromId(target.installationId, target.owner),
          repo: githubRepositoryFromPath(target.owner, target.repo),
          tab: 'actions',
          prState: 'open',
        },
      })
    case 'plan':
      return base(teamScope, 'team.plans', { filter: target.planId })
    case 'agent-session':
      return base(teamScope, 'team.agent', { agentSessionId: target.sessionId })
    default:
      return null
  }
}
