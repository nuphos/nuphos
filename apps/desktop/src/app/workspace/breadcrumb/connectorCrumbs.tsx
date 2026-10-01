import { isObservabilityActive } from '../../../app/navItems'
import { CloudLogo } from '../../../components/CloudLogo'
import { DatabaseEngineGlyph } from '../../../components/DatabaseEngineIcon'
import {
  CONNECTOR_PARENT_KINDS,
  CONNECTOR_PARENT_META,
  connectorParentRef,
  connectorParentScope,
  isIntegrationNavigation,
} from '../../../lib/connectorScopeCrumb'

import type { BreadcrumbContext } from './breadcrumbContext'
import type { ConnectorCrumbEntry } from '../../../app/workspaceTabState'
import type { BreadcrumbSegment } from '../../../components/Toolbar'
import type { ConnectorParentKind } from '../../../lib/connectorScopeCrumb'

export function pushConnectorCrumbs(ctx: BreadcrumbContext, out: BreadcrumbSegment[]): void {
  const { scope, active, accounts, enterScope, enterCluster, databaseConnectionsByTeam } = ctx

  const connectorParent = connectorParentRef(scope)

  if (connectorParent) {
    const inSettingsIntegrations = isIntegrationNavigation(scope, active)
    const countBy = <T,>(items: T[], key: (item: T) => string) =>
      items.reduce((counts, item) => {
        counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)

        return counts
      }, new Map<string, number>())
    const plural = (count: number, noun: string) =>
      `${String(count)} ${noun}${count === 1 ? '' : 's'}`
    const uniqueBy = <T,>(items: T[], key: (item: T) => string) => {
      const seen = new Map<string, T>()

      for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item)

      return Array.from(seen.values())
    }

    const awsList = accounts?.aws ?? []
    const gcpList = accounts?.gcp ?? []
    const azureList = accounts?.azure ?? []
    // Databases arrive on their own fetch, so they have their own in-flight
    // signal — `accounts` resolving says nothing about them.
    const databases = databaseConnectionsByTeam[scope.teamId]
    const databaseList = databases ?? []
    const roleCounts = countBy(awsList, (role) => role.accountId)
    const serviceAccountCounts = countBy(gcpList, (account) => account.projectId)
    const azureAppCounts = countBy(azureList, (account) => account.subscriptionId)

    // Every connector the crumb can name, keyed by parent kind. A `Record`, so
    // a new provider cannot reach the Connectors trail without appearing here.
    const entries: Record<ConnectorParentKind, ConnectorCrumbEntry[]> = {
      'onprem-cluster': (accounts?.onprem ?? [])
        .filter((cluster) => cluster.hasCredential)
        .map((cluster) => ({
          id: cluster.id,
          label: cluster.label,
          sublabel: cluster.contextName,
        })),
      'aws-account': uniqueBy(awsList, (role) => role.accountId).map((a) => ({
        id: a.accountId,
        label: a.alias || a.accountId,
        sublabel: plural(roleCounts.get(a.accountId) ?? 0, 'role'),
      })),
      'gcp-project': uniqueBy(gcpList, (p) => p.projectId).map((p) => ({
        id: p.projectId,
        label: p.alias || p.projectId,
        sublabel: plural(serviceAccountCounts.get(p.projectId) ?? 0, 'service account'),
      })),
      // Anchored on the subscription, not the binding: two App registrations on
      // one subscription are a single navigable place whose apps page lists both.
      'azure-subscription': uniqueBy(azureList, (a) => a.subscriptionId).map((a) => ({
        id: a.subscriptionId,
        label: a.label || a.subscriptionId,
        sublabel: plural(azureAppCounts.get(a.subscriptionId) ?? 0, 'app'),
      })),
      'cloudflare-account': (accounts?.cloudflare ?? []).map((a) => ({
        id: a.accountId,
        label: a.accountName || a.accountId,
        sublabel: a.authType === 'oauth' ? 'OAuth' : 'API token',
      })),
      'linode-account': (accounts?.linode ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        sublabel: 'Personal Access Token',
      })),
      'hetzner-account': (accounts?.hetzner ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        sublabel: 'API Token',
      })),
      'tencent-account': (accounts?.tencent ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        sublabel: 'Tencent Cloud',
      })),
      'aliyun-account': (accounts?.aliyun ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        sublabel: 'Alibaba Cloud',
      })),
      'volcengine-account': (accounts?.volcengine ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        sublabel: 'Volcengine',
      })),
      'betterstack-integration': (accounts?.betterstack ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        sublabel: [
          a.hasUptimeApiToken ? 'Uptime' : null,
          a.hasTelemetryApiToken ? 'Telemetry' : null,
        ]
          .filter(Boolean)
          .join(' + '),
      })),
      'uptime-kuma-instance': (accounts?.uptimeKuma ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        sublabel: a.baseUrl.replace(/^https?:\/\//, ''),
      })),
      'database-connection': databaseList.map((a) => ({
        id: a.id,
        label: a.name,
        sublabel: a.endpoint,
        engine: a.engine,
      })),
      'tailscale-client': (accounts?.tailscale ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        sublabel: a.clientId,
      })),
      'zeabur-provider': (accounts?.zeabur ?? []).map((a) => ({
        id: a.zeaburId,
        label: a.name,
        sublabel: a.kind === 'team' ? 'Team' : 'User',
      })),
    }

    // Picking a sibling keeps the kind of page you were on where the provider
    // has a counterpart, and otherwise lands on its default.
    const pickedActive = (kind: ConnectorParentKind): string | undefined => {
      if (kind === 'aws-account') {
        return scope.kind === 'aws-ecs-cluster'
          ? 'aws.ecs'
          : inSettingsIntegrations
            ? 'aws.roles'
            : isObservabilityActive(active)
              ? 'observability.dashboards'
              : undefined
      }
      if (kind === 'gcp-project') {
        return inSettingsIntegrations
          ? 'gcp.service-accounts'
          : isObservabilityActive(active)
            ? 'observability.dashboards'
            : undefined
      }
      if (kind === 'cloudflare-account') {
        return inSettingsIntegrations ? 'cloudflare.iam' : undefined
      }

      return undefined
    }

    // The crumb draws at 14px, its picker rows at 16px — same glyph, two sizes.
    const crumbIcon = (
      kind: ConnectorParentKind,
      entry: ConnectorCrumbEntry | undefined,
      size: 14 | 16,
    ) => {
      const logo = CONNECTOR_PARENT_META[kind].logo

      if (logo) return <CloudLogo provider={logo} size={size} />

      return (
        <DatabaseEngineGlyph
          engine={entry?.engine}
          className={size === 16 ? 'h-4 w-4' : 'h-3.5 w-3.5'}
        />
      )
    }

    const current = entries[connectorParent.kind].find((e) => e.id === connectorParent.id)
    const currentLabel =
      connectorParent.kind === 'onprem-cluster' && scope.kind === 'cluster'
        ? scope.clusterName
        : CONNECTOR_PARENT_META[connectorParent.kind].fallbackLabel

    const pickConnector = (kind: ConnectorParentKind, entry: ConnectorCrumbEntry) => {
      if (kind === 'onprem-cluster') {
        const cluster = accounts?.onprem.find((candidate) => candidate.id === entry.id)

        if (!cluster) return
        enterCluster({
          teamId: scope.teamId,
          parentKind: 'onprem-cluster',
          parentId: cluster.id,
          cluster,
        })

        return
      }

      enterScope(connectorParentScope({ kind, id: entry.id }, scope.teamId), pickedActive(kind))
    }

    out.push({
      label: current?.label ?? currentLabel,
      isResource: true,
      icon: crumbIcon(connectorParent.kind, current, 14),
      loading: connectorParent.kind === 'database-connection' ? databases === undefined : !accounts,
      options: CONNECTOR_PARENT_KINDS.flatMap((kind) =>
        entries[kind].map((entry) => ({
          key: `${kind}/${entry.id}`,
          label: entry.label,
          sublabel: entry.sublabel,
          group: CONNECTOR_PARENT_META[kind].group,
          icon: crumbIcon(kind, entry, 16),
          selected: kind === connectorParent.kind && entry.id === connectorParent.id,
          onPick: () => pickConnector(kind, entry),
        })),
      ),
    })
  }
}
