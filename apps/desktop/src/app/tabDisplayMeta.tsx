import { Container, FolderTree, Plus, Server } from 'lucide-react'

import { CloudLogo } from '../components/CloudLogo'
import { DatabaseEngineGlyph } from '../components/DatabaseEngineIcon'

import { activeNavItemFor, k8sResourceIcon, titleFromLocation } from './navItems'
import { scopeChip } from './scopeChip'
import { pageLocationForTab } from './workspaceTabFactory'

import type { PageLocation } from '../lib/appRoutes'
import type { DatabaseConnection } from '../types'
import type { AccountSet, WorkspaceTabState } from './workspaceTabState'

export type WorkspaceTabDisplayMeta = {
  title: string
  icon: React.ReactNode
  location: PageLocation
}

export function workspaceTabDisplayMeta(
  tab: WorkspaceTabState,
  accounts: AccountSet | undefined,
  databaseConnections: DatabaseConnection[] = [],
): WorkspaceTabDisplayMeta {
  const base = workspaceTabDisplayMetaBase(tab, accounts, databaseConnections)

  // A tab opened from a Favorites row wears that row's name for as long as it
  // stays on the page it opened to — clicking "Zeabur · Monitors" must not
  // produce a tab called "Monitors". Navigating away stops the href matching,
  // and the tab goes back to naming itself.
  if (tab.favoriteTitle?.href === base.location.href) {
    const chip = scopeChip(tab.scope, accounts, databaseConnections, tab.clusterLabel)

    return { ...base, title: tab.favoriteTitle.title, icon: chip?.icon ?? base.icon }
  }

  return base
}

function workspaceTabDisplayMetaBase(
  tab: WorkspaceTabState,
  accounts: AccountSet | undefined,
  databaseConnections: DatabaseConnection[] = [],
): WorkspaceTabDisplayMeta {
  const location = pageLocationForTab(tab)

  if (tab.pageMeta?.location.href === location.href) {
    return {
      title: tab.pageMeta.title,
      icon: tab.pageMeta.icon,
      location,
    }
  }

  if (tab.target) {
    return {
      title: tab.target.name,
      icon: k8sResourceIcon(tab.target.kind),
      location,
    }
  }

  if (tab.scope.kind === 'team' && tab.active === 'team.new-tab') {
    return {
      title: 'New Tab',
      icon: <Plus className="h-3.5 w-3.5 text-tertiary" strokeWidth={1.8} />,
      location,
    }
  }

  const scopedNavItem = activeNavItemFor(tab.scope, tab.active)

  // A tab restored from a previous session but not yet activated has no live
  // pageMeta; fall back to the label captured at persist time (e.g. an agent
  // chat's title) rather than the generic scope name. Once the tab mounts and
  // sets pageMeta, the check above takes over.
  if (tab.restoredTitle && !tab.pageMeta) {
    return {
      title: tab.restoredTitle,
      icon: scopedNavItem?.icon ?? (
        <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
      ),
      location,
    }
  }

  if (scopedNavItem) {
    return { title: scopedNavItem.label, icon: scopedNavItem.icon, location }
  }

  const scope = tab.scope

  switch (scope.kind) {
    case 'team':
      return {
        title: titleFromLocation(location),
        icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        location,
      }
    case 'aws-account': {
      const account = accounts?.aws.find((a) => a.accountId === scope.accountId)

      return {
        title: account?.alias || account?.accountId || titleFromLocation(location),
        icon: <CloudLogo provider="aws" size={14} />,
        location,
      }
    }
    case 'gcp-project': {
      const project = accounts?.gcp.find((p) => p.projectId === scope.projectId)

      return {
        title: project?.alias || project?.projectId || titleFromLocation(location),
        icon: <CloudLogo provider="gcp" size={14} />,
        location,
      }
    }
    case 'azure-subscription':
      return {
        title: scope.subscriptionId || titleFromLocation(location),
        icon: <CloudLogo provider="azure" size={14} />,
        location,
      }
    case 'cloudflare-account': {
      const account = accounts?.cloudflare.find((a) => a.accountId === scope.accountId)

      return {
        title: account?.accountName || account?.accountId || titleFromLocation(location),
        icon: <CloudLogo provider="cloudflare" size={14} />,
        location,
      }
    }
    case 'linode-account': {
      const account = accounts?.linode.find((a) => a.id === scope.accountId)

      return {
        title: account?.label || titleFromLocation(location),
        icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        location,
      }
    }
    case 'hetzner-account': {
      const account = accounts?.hetzner.find((a) => a.id === scope.accountId)

      return {
        title: account?.label || titleFromLocation(location),
        icon: <CloudLogo provider="hetzner" size={14} />,
        location,
      }
    }
    case 'tencent-account': {
      const account = accounts?.tencent.find((a) => a.id === scope.accountId)

      return {
        title: account?.label || titleFromLocation(location),
        icon: <CloudLogo provider="tencent" size={14} />,
        location,
      }
    }
    case 'aliyun-account': {
      const account = accounts?.aliyun.find((a) => a.id === scope.accountId)

      return {
        title: account?.label || titleFromLocation(location),
        icon: <CloudLogo provider="aliyun" size={14} />,
        location,
      }
    }
    case 'volcengine-account': {
      const account = accounts?.volcengine.find((a) => a.id === scope.accountId)

      return {
        title: account?.label || titleFromLocation(location),
        icon: <CloudLogo provider="volcengine" size={14} />,
        location,
      }
    }
    case 'betterstack-integration': {
      const integration = accounts?.betterstack.find((item) => item.id === scope.integrationId)

      return {
        title: integration?.label || titleFromLocation(location),
        icon: <CloudLogo provider="betterstack" size={14} />,
        location,
      }
    }
    case 'uptime-kuma-instance': {
      const instance = accounts?.uptimeKuma.find((item) => item.id === scope.instanceId)

      return {
        title: instance?.label || titleFromLocation(location),
        icon: <CloudLogo provider="uptime-kuma" size={14} />,
        location,
      }
    }
    case 'database-connection': {
      const connection = databaseConnections.find((item) => item.id === scope.connectionId)

      return {
        title: connection?.name || titleFromLocation(location),
        icon: <DatabaseEngineGlyph engine={connection?.engine} className="h-3.5 w-3.5" />,
        location,
      }
    }
    case 'compliance-integration': {
      const integration = (
        scope.provider === 'vanta' ? accounts?.vanta : accounts?.secureframe
      )?.find((item) => item.id === scope.integrationId)

      return {
        title: integration?.label || titleFromLocation(location),
        icon: <CloudLogo provider={scope.provider} size={14} />,
        location,
      }
    }
    case 'tailscale-client': {
      const client = accounts?.tailscale.find((item) => item.id === scope.clientId)

      return {
        title: client?.label || titleFromLocation(location),
        icon: <CloudLogo provider="tailscale" size={14} />,
        location,
      }
    }
    case 'zeabur-provider': {
      const provider = accounts?.zeabur.find((item) => item.zeaburId === scope.zeaburId)

      return {
        title: provider?.name || titleFromLocation(location),
        icon: <CloudLogo provider="zeabur" size={14} />,
        location,
      }
    }
    case 'cloudflare-zone':
      return {
        title: scope.zoneName || titleFromLocation(location),
        icon: <CloudLogo provider="cloudflare" size={14} />,
        location,
      }
    case 'cluster':
      return {
        title: tab.clusterLabel || scope.clusterName,
        icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        location,
      }
    case 'aws-ecs-cluster':
      return {
        title: scope.clusterName,
        icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        location,
      }
  }
}
