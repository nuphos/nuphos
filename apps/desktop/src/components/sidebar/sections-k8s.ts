import {
  Bell,
  Box,
  Boxes,
  CircleDot,
  Compass,
  Container,
  FileBox,
  Globe,
  HardDrive,
  Layers,
  LayoutDashboard,
  Network,
  Package,
  Server,
  Shield,
  ShieldCheck,
  Timer,
  Workflow,
} from 'lucide-react'

import type { Section } from './types'

export function clusterSections(customResourceSections: Section[] = []): Section[] {
  return [
    {
      title: 'Cluster',
      items: [
        { key: 'cluster.events', label: 'Events', icon: Bell, enabled: true },
        { key: 'cluster.overview', label: 'Overview', icon: Compass, enabled: true },
        { key: 'cluster.nodes', label: 'Nodes', icon: Server, enabled: true },
      ],
    },
    {
      title: 'Workloads',
      items: [
        { key: 'helm.releases', label: 'Helm Releases', icon: Package, enabled: true },
        { key: 'workloads.deployments', label: 'Deployments', icon: Layers, enabled: true },
        { key: 'workloads.pods', label: 'Pods', icon: Box, enabled: true },
        { key: 'workloads.replicasets', label: 'ReplicaSets', icon: Boxes, enabled: true },
        { key: 'workloads.statefulsets', label: 'StatefulSets', icon: Container, enabled: true },
        { key: 'workloads.daemonsets', label: 'DaemonSets', icon: Package, enabled: true },
        { key: 'workloads.jobs', label: 'Jobs', icon: Timer, enabled: true },
        { key: 'workloads.cronjobs', label: 'CronJobs', icon: Timer, enabled: true },
      ],
    },
    {
      title: 'Networking',
      items: [
        { key: 'networking.services', label: 'Services', icon: Network, enabled: true },
        { key: 'networking.ingresses', label: 'Ingresses', icon: Globe, enabled: true },
        {
          key: 'networking.endpoint-slices',
          label: 'Endpoint Slices',
          icon: CircleDot,
          enabled: true,
        },
        {
          key: 'networking.network-policies',
          label: 'Network Policies',
          icon: ShieldCheck,
          enabled: true,
        },
      ],
    },
    {
      title: 'Access Control',
      items: [
        { key: 'access.service-accounts', label: 'Service Accounts', icon: Shield, enabled: true },
        { key: 'access.roles', label: 'Roles', icon: ShieldCheck, enabled: true },
        { key: 'access.role-bindings', label: 'Role Bindings', icon: ShieldCheck, enabled: true },
        { key: 'access.cluster-roles', label: 'Cluster Roles', icon: ShieldCheck, enabled: true },
        {
          key: 'access.cluster-role-bindings',
          label: 'Cluster Role Bindings',
          icon: ShieldCheck,
          enabled: true,
        },
      ],
    },
    {
      title: 'Configuration',
      items: [
        { key: 'config.configmaps', label: 'ConfigMaps', icon: FileBox, enabled: true },
        { key: 'config.secrets', label: 'Secrets', icon: Shield, enabled: true },
      ],
    },
    {
      title: 'Storage',
      items: [
        {
          key: 'storage.storage-classes',
          label: 'Storage Classes',
          icon: HardDrive,
          enabled: true,
        },
        {
          key: 'storage.persistent-volumes',
          label: 'Persistent Volumes',
          icon: HardDrive,
          enabled: true,
        },
        { key: 'storage.persistent-volume-claims', label: 'PVCs', icon: HardDrive, enabled: true },
      ],
    },
    {
      title: 'Custom Resources',
      items: [
        { key: 'custom.crds', label: 'CRDs', icon: FileBox, enabled: true },
        { key: 'custom.resources', label: 'Custom Resources', icon: FileBox, enabled: true },
      ],
    },
    ...customResourceSections,
  ]
}

export function ecsClusterSections(): Section[] {
  return [
    {
      title: 'Cluster',
      items: [
        { key: 'ecs.services', label: 'Services', icon: Workflow, enabled: true },
        { key: 'ecs.tasks', label: 'Tasks', icon: Boxes, enabled: true },
        { key: 'ecs.infrastructure', label: 'Infrastructure', icon: Server, enabled: true },
        { key: 'ecs.metrics', label: 'Metrics', icon: LayoutDashboard, enabled: true },
      ],
    },
  ]
}
