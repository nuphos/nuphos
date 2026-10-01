import {
  faDatabase,
  faGaugeHigh,
  faServer,
  faTableColumns,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  ChartLine,
  Compass,
  Container,
  FolderTree,
  GitPullRequest,
  Layers,
  LayoutDashboard,
  Scroll,
  Server,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from 'lucide-react'

import type { NavItemMeta } from './types'
import type { Scope } from '../../types'

export function linodeAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'linode.instances',
      label: 'Linodes',
      group: 'Compute',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'linode.lke',
      label: 'LKE Clusters',
      group: 'Kubernetes',
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function hetznerAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'hetzner.servers',
      label: 'Servers',
      group: 'Compute',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function tencentAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'tencent.cvm',
      label: 'CVM Instances',
      group: 'Compute',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'tencent.clusters',
      label: 'TKE Clusters',
      group: 'Kubernetes',
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function aliyunAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'aliyun.ecs',
      label: 'ECS Instances',
      group: 'Compute',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aliyun.swas',
      label: 'Simple App Server',
      group: 'Compute',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aliyun.clusters',
      label: 'ACK Clusters',
      group: 'Kubernetes',
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function volcengineAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'volcengine.ecs',
      label: 'ECS Instances',
      group: 'Compute',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'volcengine.clusters',
      label: 'VKE Clusters',
      group: 'Kubernetes',
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function betterstackIntegrationNavItems(): NavItemMeta[] {
  return [
    {
      key: 'betterstack.monitors',
      label: 'Monitors',
      group: 'Better Stack',
      icon: <FontAwesomeIcon icon={faGaugeHigh} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'betterstack.incidents',
      label: 'Incidents',
      group: 'Better Stack',
      icon: <FontAwesomeIcon icon={faTriangleExclamation} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'betterstack.sources',
      label: 'Sources',
      group: 'Better Stack',
      icon: <FontAwesomeIcon icon={faDatabase} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'betterstack.dashboards',
      label: 'Dashboards',
      group: 'Better Stack',
      icon: <FontAwesomeIcon icon={faTableColumns} className="w-3.5 h-3.5 text-tertiary" />,
    },
  ]
}

export function uptimeKumaInstanceNavItems(): NavItemMeta[] {
  return [
    {
      key: 'uptime-kuma.monitors',
      label: 'Monitors',
      group: 'Uptime Kuma',
      icon: <FontAwesomeIcon icon={faGaugeHigh} className="w-3.5 h-3.5 text-tertiary" />,
    },
  ]
}

export function databaseConnectionNavItems(): NavItemMeta[] {
  return [
    {
      key: 'database.overview',
      label: 'Overview',
      group: 'Data',
      icon: <Compass className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.collections',
      label: 'Collections',
      group: 'Data',
      icon: <Layers className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.query',
      label: 'Query',
      group: 'Data',
      icon: <Terminal className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.changes',
      label: 'Changes',
      group: 'Operations',
      icon: <GitPullRequest className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.monitoring',
      label: 'Monitoring',
      group: 'Operations',
      icon: <ChartLine className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.access',
      label: 'Access',
      group: 'Governance',
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.audit',
      label: 'Audit',
      group: 'Governance',
      icon: <Scroll className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.settings',
      label: 'Settings',
      group: 'Governance',
      icon: <Settings2 className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function complianceIntegrationNavItems(
  scope: Extract<Scope, { kind: 'compliance-integration' }>,
): NavItemMeta[] {
  return [
    {
      key: 'compliance.tests',
      label: 'Failed Tests',
      group: scope.provider === 'vanta' ? 'Vanta' : 'Secureframe',
      icon: <ShieldAlert className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function tailscaleClientNavItems(): NavItemMeta[] {
  return [
    {
      key: 'tailscale.devices',
      label: 'Devices',
      group: 'Network',
      icon: <FontAwesomeIcon icon={faServer} className="w-3.5 h-3.5 text-tertiary" />,
    },
  ]
}

export function zeaburProviderNavItems(): NavItemMeta[] {
  return [
    {
      key: 'zeabur.projects',
      label: 'Projects',
      group: 'Deployments',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'zeabur.servers',
      label: 'Servers',
      group: 'Compute',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function awsEcsClusterNavItems(): NavItemMeta[] {
  return [
    {
      key: 'ecs.services',
      label: 'Services',
      group: 'Cluster',
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'ecs.tasks',
      label: 'Tasks',
      group: 'Cluster',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'ecs.infrastructure',
      label: 'Infrastructure',
      group: 'Cluster',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'ecs.metrics',
      label: 'Metrics',
      group: 'Cluster',
      icon: <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}
