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

import { t } from '../../i18n'

import type { NavItemMeta } from './types'
import type { Scope } from '../../types'

export function linodeAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'linode.instances',
      label: t('Linodes'),
      group: t('Compute'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'linode.lke',
      label: t('LKE Clusters'),
      group: 'Kubernetes',
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function hetznerAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'hetzner.servers',
      label: t('Servers'),
      group: t('Compute'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function tencentAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'tencent.cvm',
      label: t('CVM Instances'),
      group: t('Compute'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'tencent.clusters',
      label: t('TKE Clusters'),
      group: 'Kubernetes',
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function aliyunAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'aliyun.ecs',
      label: t('ECS Instances'),
      group: t('Compute'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aliyun.swas',
      label: 'Simple App Server',
      group: t('Compute'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aliyun.clusters',
      label: t('ACK Clusters'),
      group: 'Kubernetes',
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function volcengineAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'volcengine.ecs',
      label: t('ECS Instances'),
      group: t('Compute'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'volcengine.clusters',
      label: t('VKE Clusters'),
      group: 'Kubernetes',
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function betterstackIntegrationNavItems(): NavItemMeta[] {
  return [
    {
      key: 'betterstack.monitors',
      label: t('Monitors'),
      group: 'Better Stack',
      icon: <FontAwesomeIcon icon={faGaugeHigh} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'betterstack.incidents',
      label: t('Incidents'),
      group: 'Better Stack',
      icon: <FontAwesomeIcon icon={faTriangleExclamation} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'betterstack.sources',
      label: t('Sources'),
      group: 'Better Stack',
      icon: <FontAwesomeIcon icon={faDatabase} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'betterstack.dashboards',
      label: t('Dashboards'),
      group: 'Better Stack',
      icon: <FontAwesomeIcon icon={faTableColumns} className="w-3.5 h-3.5 text-tertiary" />,
    },
  ]
}

export function uptimeKumaInstanceNavItems(): NavItemMeta[] {
  return [
    {
      key: 'uptime-kuma.monitors',
      label: t('Monitors'),
      group: 'Uptime Kuma',
      icon: <FontAwesomeIcon icon={faGaugeHigh} className="w-3.5 h-3.5 text-tertiary" />,
    },
  ]
}

export function databaseConnectionNavItems(): NavItemMeta[] {
  return [
    {
      key: 'database.overview',
      label: t('Overview'),
      group: t('Data'),
      icon: <Compass className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.collections',
      label: t('Collections'),
      group: t('Data'),
      icon: <Layers className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.query',
      label: t('Query'),
      group: t('Data'),
      icon: <Terminal className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.changes',
      label: t('Changes'),
      group: t('Operations'),
      icon: <GitPullRequest className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.monitoring',
      label: t('Monitoring'),
      group: t('Operations'),
      icon: <ChartLine className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.access',
      label: t('Access'),
      group: t('Governance'),
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.audit',
      label: t('Audit'),
      group: t('Governance'),
      icon: <Scroll className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'database.settings',
      label: t('Settings'),
      group: t('Governance'),
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
      label: t('Failed Tests'),
      group: scope.provider === 'vanta' ? 'Vanta' : 'Secureframe',
      icon: <ShieldAlert className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function tailscaleClientNavItems(): NavItemMeta[] {
  return [
    {
      key: 'tailscale.devices',
      label: t('Devices'),
      group: t('Network'),
      icon: <FontAwesomeIcon icon={faServer} className="w-3.5 h-3.5 text-tertiary" />,
    },
  ]
}

export function zeaburProviderNavItems(): NavItemMeta[] {
  return [
    {
      key: 'zeabur.projects',
      label: t('Projects'),
      group: t('Deployments'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'zeabur.servers',
      label: t('Servers'),
      group: t('Compute'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function awsEcsClusterNavItems(): NavItemMeta[] {
  return [
    {
      key: 'ecs.services',
      label: t('Services'),
      group: t('Cluster'),
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'ecs.tasks',
      label: t('Tasks'),
      group: t('Cluster'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'ecs.infrastructure',
      label: t('Infrastructure'),
      group: t('Cluster'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'ecs.metrics',
      label: t('Metrics'),
      group: t('Cluster'),
      icon: <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}
