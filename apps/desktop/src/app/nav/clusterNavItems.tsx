import { Bell, Cloud, FolderTree, Package, Server, ShieldCheck, Timer } from 'lucide-react'

import { t } from '../../i18n'
import { customResourceNavigationMetadata } from '../../lib/customResourceNavigation'

import type { NavItemMeta } from './types'

export function clusterScopeNavItems(active: string): NavItemMeta[] {
  const customResourceMetadata = customResourceNavigationMetadata(active)

  return [
    {
      key: 'cluster.events',
      label: t('Events'),
      group: t('Cluster'),
      icon: <Bell className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'cluster.overview',
      label: t('Overview'),
      group: t('Cluster'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'cluster.nodes',
      label: t('Nodes'),
      group: t('Cluster'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'helm.releases',
      label: t('Helm Releases'),
      group: t('Workloads'),
      icon: <Package className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.deployments',
      label: t('Deployments'),
      group: t('Workloads'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.pods',
      label: t('Pods'),
      group: t('Workloads'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.replicasets',
      label: t('ReplicaSets'),
      group: t('Workloads'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.statefulsets',
      label: t('StatefulSets'),
      group: t('Workloads'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.daemonsets',
      label: t('DaemonSets'),
      group: t('Workloads'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.jobs',
      label: t('Jobs'),
      group: t('Workloads'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.cronjobs',
      label: t('CronJobs'),
      group: t('Workloads'),
      icon: <Timer className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'networking.services',
      label: t('Services'),
      group: t('Networking'),
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'networking.ingresses',
      label: t('Ingresses'),
      group: t('Networking'),
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'networking.endpoint-slices',
      label: t('Endpoint Slices'),
      group: t('Networking'),
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'networking.network-policies',
      label: t('Network Policies'),
      group: t('Networking'),
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'access.service-accounts',
      label: t('Service Accounts'),
      group: t('Access Control'),
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'access.roles',
      label: t('Roles'),
      group: t('Access Control'),
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'access.role-bindings',
      label: t('Role Bindings'),
      group: t('Access Control'),
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'access.cluster-roles',
      label: t('Cluster Roles'),
      group: t('Access Control'),
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'access.cluster-role-bindings',
      label: t('Cluster Role Bindings'),
      group: t('Access Control'),
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'config.configmaps',
      label: t('ConfigMaps'),
      group: t('Configuration'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'config.secrets',
      label: t('Secrets'),
      group: t('Configuration'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'storage.storage-classes',
      label: t('Storage Classes'),
      group: t('Storage'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'storage.persistent-volumes',
      label: t('Persistent Volumes'),
      group: t('Storage'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'storage.persistent-volume-claims',
      label: t('PVCs'),
      group: t('Storage'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'custom.crds',
      label: 'CRDs',
      group: t('Custom Resources'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'custom.resources',
      label: t('Custom Resources'),
      group: t('Custom Resources'),
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    ...(customResourceMetadata
      ? [
          {
            ...customResourceMetadata,
            icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
          },
        ]
      : []),
  ]
}
