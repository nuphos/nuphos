import { Bell, Cloud, FolderTree, Package, Server, ShieldCheck, Timer } from 'lucide-react'

import { customResourceNavigationMetadata } from '../../lib/customResourceNavigation'

import type { NavItemMeta } from './types'

export function clusterScopeNavItems(active: string): NavItemMeta[] {
  const customResourceMetadata = customResourceNavigationMetadata(active)

  return [
    {
      key: 'cluster.events',
      label: 'Events',
      group: 'Cluster',
      icon: <Bell className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'cluster.overview',
      label: 'Overview',
      group: 'Cluster',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'cluster.nodes',
      label: 'Nodes',
      group: 'Cluster',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'helm.releases',
      label: 'Helm Releases',
      group: 'Workloads',
      icon: <Package className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.deployments',
      label: 'Deployments',
      group: 'Workloads',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.pods',
      label: 'Pods',
      group: 'Workloads',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.replicasets',
      label: 'ReplicaSets',
      group: 'Workloads',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.statefulsets',
      label: 'StatefulSets',
      group: 'Workloads',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.daemonsets',
      label: 'DaemonSets',
      group: 'Workloads',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.jobs',
      label: 'Jobs',
      group: 'Workloads',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'workloads.cronjobs',
      label: 'CronJobs',
      group: 'Workloads',
      icon: <Timer className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'networking.services',
      label: 'Services',
      group: 'Networking',
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'networking.ingresses',
      label: 'Ingresses',
      group: 'Networking',
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'networking.endpoint-slices',
      label: 'Endpoint Slices',
      group: 'Networking',
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'networking.network-policies',
      label: 'Network Policies',
      group: 'Networking',
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'access.service-accounts',
      label: 'Service Accounts',
      group: 'Access Control',
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'access.roles',
      label: 'Roles',
      group: 'Access Control',
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'access.role-bindings',
      label: 'Role Bindings',
      group: 'Access Control',
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'access.cluster-roles',
      label: 'Cluster Roles',
      group: 'Access Control',
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'access.cluster-role-bindings',
      label: 'Cluster Role Bindings',
      group: 'Access Control',
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'config.configmaps',
      label: 'ConfigMaps',
      group: 'Configuration',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'config.secrets',
      label: 'Secrets',
      group: 'Configuration',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'storage.storage-classes',
      label: 'Storage Classes',
      group: 'Storage',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'storage.persistent-volumes',
      label: 'Persistent Volumes',
      group: 'Storage',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'storage.persistent-volume-claims',
      label: 'PVCs',
      group: 'Storage',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'custom.crds',
      label: 'CRDs',
      group: 'Custom Resources',
      icon: <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'custom.resources',
      label: 'Custom Resources',
      group: 'Custom Resources',
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
