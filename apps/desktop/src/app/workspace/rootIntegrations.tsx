import { CloudLogo } from '../../components/CloudLogo'
import { DatabaseEngineGlyph } from '../../components/DatabaseEngineIcon'
import { isDatabaseEngineReleased } from '../../lib/databaseRelease'

import type {
  DatabaseConnection,
  GithubInstallation,
  GitlabBindingNamespaces,
  GrafanaInstance,
} from '../../types'
import type { AccountSet } from '../workspaceTabState'

export function computeRootIntegrations({
  teamId,
  accounts,
  databaseConnectionsByTeam,
  grafanaInstancesByTeam,
  githubInstallationsByTeam,
  gitlabNamespacesByTeam,
}: {
  teamId: string | undefined
  accounts: AccountSet | undefined
  databaseConnectionsByTeam: Record<string, DatabaseConnection[] | undefined>
  grafanaInstancesByTeam: Record<string, GrafanaInstance[] | undefined>
  githubInstallationsByTeam: Record<string, GithubInstallation[] | undefined>
  gitlabNamespacesByTeam: Record<string, GitlabBindingNamespaces[] | undefined>
}) {
  const databaseItems = [
    // Bound databases are connectors: one item per connection, keyed by
    // engine so PostgreSQL later joins the same sidebar section.
    ...(teamId
      ? (databaseConnectionsByTeam[teamId] ?? [])
          .filter((connection) => isDatabaseEngineReleased(connection.engine))
          .map((connection) => ({
            key: `integration:${connection.engine}:${connection.id}`,
            label: connection.name,
            iconNode: <DatabaseEngineGlyph engine={connection.engine} className="h-3.5 w-3.5" />,
            enabled: true,
          }))
      : []),
  ]

  if (!accounts) return databaseItems
  const awsAccounts = Array.from(
    new Map(accounts.aws.map((account) => [account.accountId, account])).values(),
  )
  const gcpProjects = Array.from(
    new Map(accounts.gcp.map((project) => [project.projectId, project])).values(),
  )

  return [
    ...databaseItems,
    ...awsAccounts.map((account) => {
      return {
        key: `integration:aws:${account.accountId}`,
        label: account.alias || account.accountId,
        iconNode: <CloudLogo provider="aws" size={16} />,
        enabled: true,
      }
    }),
    ...gcpProjects.map((project) => {
      return {
        key: `integration:gcp:${project.projectId}`,
        label: project.alias || project.projectId,
        iconNode: <CloudLogo provider="gcp" size={16} />,
        enabled: true,
      }
    }),
    // Navigation shortcut only: the Observability sidebar group lists each
    // GCP project's Cloud Monitoring metrics page (the canonical home stays
    // inside the project scope, next to GKE/GCE).
    ...gcpProjects.map((project) => {
      return {
        key: `integration:gcp-monitoring:${project.projectId}`,
        label: `${project.alias || project.projectId} · Cloud Monitoring`,
        iconNode: <CloudLogo provider="gcp" size={16} />,
        enabled: true,
      }
    }),
    ...accounts.cloudflare.map((account) => ({
      key: `integration:cloudflare:${account.accountId}`,
      label: account.accountName || account.accountId,
      iconNode: <CloudLogo provider="cloudflare" size={16} />,
      enabled: true,
    })),
    ...accounts.linode.map((account) => ({
      key: `integration:linode:${account.id}`,
      label: account.label,
      iconNode: <CloudLogo provider="linode" size={16} />,
      enabled: true,
    })),
    ...accounts.hetzner.map((account) => ({
      key: `integration:hetzner:${account.id}`,
      label: account.label,
      iconNode: <CloudLogo provider="hetzner" size={16} />,
      enabled: true,
    })),
    ...accounts.betterstack.map((integration) => ({
      key: `integration:betterstack:${integration.id}`,
      label: integration.label,
      iconNode: <CloudLogo provider="betterstack" size={16} />,
      enabled: true,
    })),
    ...accounts.uptimeKuma.map((instance) => ({
      key: `integration:uptime-kuma:${instance.id}`,
      label: instance.label,
      iconNode: <CloudLogo provider="uptime-kuma" size={16} />,
      enabled: true,
    })),
    ...accounts.secureframe.map((integration) => ({
      key: `integration:secureframe:${integration.id}`,
      label: integration.label,
      iconNode: <CloudLogo provider="secureframe" size={16} />,
      enabled: true,
    })),
    ...accounts.vanta.map((integration) => ({
      key: `integration:vanta:${integration.id}`,
      label: integration.label,
      iconNode: <CloudLogo provider="vanta" size={16} />,
      enabled: true,
    })),
    ...accounts.tailscale.map((client) => ({
      key: `integration:tailscale:${client.id}`,
      label: client.label,
      iconNode: <CloudLogo provider="tailscale" size={16} />,
      enabled: true,
    })),
    ...accounts.zeabur.map((provider) => ({
      key: `integration:zeabur:${provider.zeaburId}`,
      label: provider.name,
      iconNode: <CloudLogo provider="zeabur" size={16} />,
      enabled: true,
    })),
    ...accounts.tencent.map((account) => ({
      key: `integration:tencent:${account.id}`,
      label: account.label,
      iconNode: <CloudLogo provider="tencent" size={16} />,
      enabled: true,
    })),
    ...accounts.aliyun.map((account) => ({
      key: `integration:aliyun:${account.id}`,
      label: account.label,
      iconNode: <CloudLogo provider="aliyun" size={16} />,
      enabled: true,
    })),
    ...accounts.volcengine.map((account) => ({
      key: `integration:volcengine:${account.id}`,
      label: account.label,
      iconNode: <CloudLogo provider="volcengine" size={16} />,
      enabled: true,
    })),
    // Keyed by subscriptionId (not binding id) — the azure-subscription
    // scope anchors on it, so the sidebar key doubles as the nav target.
    // Deduped on it too: two App bindings on the same subscription are one
    // navigable place (the apps drill-down lists both), not two rows.
    ...accounts.azure
      .filter(
        (account, index, list) =>
          list.findIndex((other) => other.subscriptionId === account.subscriptionId) === index,
      )
      .map((account) => ({
        key: `integration:azure:${account.subscriptionId}`,
        label: account.label,
        iconNode: <CloudLogo provider="azure" size={16} />,
        enabled: true,
      })),
    ...(teamId
      ? (grafanaInstancesByTeam[teamId] ?? []).map((instance) => ({
          key: `integration:grafana:${instance.id}`,
          label: instance.name,
          iconNode: <CloudLogo provider="grafana" size={16} />,
          enabled: true,
        }))
      : []),
    ...(teamId
      ? (githubInstallationsByTeam[teamId] ?? []).map((installation) => ({
          key: `integration:github:${String(installation.installationId)}`,
          label: installation.accountLogin,
          iconNode: <CloudLogo provider="github" size={16} />,
          enabled: true,
        }))
      : []),
    ...(teamId
      ? (gitlabNamespacesByTeam[teamId] ?? []).flatMap((entry) =>
          entry.namespaces.length > 0
            ? entry.namespaces.map((ns) => ({
                key: `integration:gitlab:${entry.bindingId}:${ns.fullPath}`,
                label: ns.kind === 'user' ? `@${ns.fullPath}` : ns.name,
                iconNode: <CloudLogo provider="gitlab" size={16} />,
                enabled: true,
              }))
            : [
                // Namespace listing failed (e.g. revoked token) — fall back
                // to a binding-level item that lands on the accounts list.
                {
                  key: `integration:gitlab:${entry.bindingId}`,
                  label: entry.username,
                  iconNode: <CloudLogo provider="gitlab" size={16} />,
                  enabled: true,
                },
              ],
        )
      : []),
  ]
}
