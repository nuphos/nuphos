import { Container, Server } from 'lucide-react'

import { CloudLogo } from '../components/CloudLogo'
import { DatabaseEngineGlyph } from '../components/DatabaseEngineIcon'

import type { DatabaseConnection, Scope } from '../types'
import type { AccountSet } from './workspaceTabState'

/**
 * Whatever a scope points at — the BetterStack instance, the AWS account, the
 * cluster — as the provider's logo plus its name. Null for team scopes, which
 * every page in the app shares and so identify nothing.
 *
 * A page name on its own ("Monitors") can't say which service it belongs to,
 * which is why Favorites qualify their label with this.
 */
export function scopeChip(
  scope: Scope,
  accounts: AccountSet | undefined,
  databaseConnections: DatabaseConnection[] = [],
  clusterLabel?: string | null,
): { label: string; icon: React.ReactNode } | null {
  const chip = (label: string | null | undefined, icon: React.ReactNode) =>
    label ? { label, icon } : null

  switch (scope.kind) {
    case 'team':
      return null
    case 'aws-account': {
      const account = accounts?.aws.find((a) => a.accountId === scope.accountId)

      return chip(account?.alias || account?.accountId, <CloudLogo provider="aws" size={14} />)
    }
    case 'gcp-project': {
      const project = accounts?.gcp.find((p) => p.projectId === scope.projectId)

      return chip(project?.alias || project?.projectId, <CloudLogo provider="gcp" size={14} />)
    }
    case 'azure-subscription':
      return chip(scope.subscriptionId, <CloudLogo provider="azure" size={14} />)
    case 'cloudflare-account': {
      const account = accounts?.cloudflare.find((a) => a.accountId === scope.accountId)

      return chip(
        account?.accountName || account?.accountId,
        <CloudLogo provider="cloudflare" size={14} />,
      )
    }
    case 'cloudflare-zone':
      return chip(scope.zoneName, <CloudLogo provider="cloudflare" size={14} />)
    case 'linode-account':
      return chip(
        accounts?.linode.find((a) => a.id === scope.accountId)?.label,
        <Server className="w-3.5 h-3.5" strokeWidth={1.8} />,
      )
    case 'hetzner-account':
      return chip(
        accounts?.hetzner.find((a) => a.id === scope.accountId)?.label,
        <CloudLogo provider="hetzner" size={14} />,
      )
    case 'tencent-account':
      return chip(
        accounts?.tencent.find((a) => a.id === scope.accountId)?.label,
        <CloudLogo provider="tencent" size={14} />,
      )
    case 'aliyun-account':
      return chip(
        accounts?.aliyun.find((a) => a.id === scope.accountId)?.label,
        <CloudLogo provider="aliyun" size={14} />,
      )
    case 'volcengine-account':
      return chip(
        accounts?.volcengine.find((a) => a.id === scope.accountId)?.label,
        <CloudLogo provider="volcengine" size={14} />,
      )
    case 'betterstack-integration':
      return chip(
        accounts?.betterstack.find((i) => i.id === scope.integrationId)?.label,
        <CloudLogo provider="betterstack" size={14} />,
      )
    case 'uptime-kuma-instance':
      return chip(
        accounts?.uptimeKuma.find((i) => i.id === scope.instanceId)?.label,
        <CloudLogo provider="uptime-kuma" size={14} />,
      )
    case 'database-connection': {
      const connection = databaseConnections.find((c) => c.id === scope.connectionId)

      return chip(
        connection?.name,
        <DatabaseEngineGlyph engine={connection?.engine} className="h-3.5 w-3.5" />,
      )
    }
    case 'compliance-integration':
      return chip(
        (scope.provider === 'vanta' ? accounts?.vanta : accounts?.secureframe)?.find(
          (i) => i.id === scope.integrationId,
        )?.label,
        <CloudLogo provider={scope.provider} size={14} />,
      )
    case 'tailscale-client':
      return chip(
        accounts?.tailscale.find((c) => c.id === scope.clientId)?.label,
        <CloudLogo provider="tailscale" size={14} />,
      )
    case 'zeabur-provider':
      return chip(
        accounts?.zeabur.find((p) => p.zeaburId === scope.zeaburId)?.name,
        <CloudLogo provider="zeabur" size={14} />,
      )
    case 'cluster':
      return chip(
        clusterLabel || scope.clusterName,
        <Server className="w-3.5 h-3.5" strokeWidth={1.8} />,
      )
    case 'aws-ecs-cluster':
      return chip(scope.clusterName, <Container className="w-3.5 h-3.5" strokeWidth={1.8} />)
  }
}
