import type { DetailTarget } from '../../views/DetailView'

// ---------------------------------------------------------------------------
// Shared k8s detail-kind vocabulary (moved from App.tsx).
// ---------------------------------------------------------------------------

export function detailKindFromUrlSegment(kind: string): DetailTarget['kind'] | null {
  const normalized = kind.toLowerCase().replace(/[-_]/g, '')
  const map: Record<string, DetailTarget['kind']> = {
    pod: 'Pod',
    deployment: 'Deployment',
    service: 'Service',
    node: 'Node',
    replicaset: 'ReplicaSet',
    statefulset: 'StatefulSet',
    daemonset: 'DaemonSet',
    job: 'Job',
    cronjob: 'CronJob',
    ingress: 'Ingress',
    networkpolicy: 'NetworkPolicy',
    endpointslice: 'EndpointSlice',
    serviceaccount: 'ServiceAccount',
    role: 'Role',
    rolebinding: 'RoleBinding',
    clusterrole: 'ClusterRole',
    clusterrolebinding: 'ClusterRoleBinding',
    configmap: 'ConfigMap',
    secret: 'Secret',
    persistentvolume: 'PersistentVolume',
    persistentvolumeclaim: 'PersistentVolumeClaim',
    storageclass: 'StorageClass',
    helmrelease: 'HelmRelease',
    customresourcedefinition: 'CustomResourceDefinition',
    customresource: 'CustomResource',
  }

  return map[normalized] ?? null
}

export function activeKeyForDetailKind(kind: DetailTarget['kind']): string {
  switch (kind) {
    case 'Node':
      return 'cluster.nodes'
    case 'Deployment':
      return 'workloads.deployments'
    case 'ReplicaSet':
      return 'workloads.replicasets'
    case 'StatefulSet':
      return 'workloads.statefulsets'
    case 'DaemonSet':
      return 'workloads.daemonsets'
    case 'Job':
      return 'workloads.jobs'
    case 'CronJob':
      return 'workloads.cronjobs'
    case 'HelmRelease':
      return 'helm.releases'
    case 'Service':
      return 'networking.services'
    case 'Ingress':
      return 'networking.ingresses'
    case 'EndpointSlice':
      return 'networking.endpoint-slices'
    case 'NetworkPolicy':
      return 'networking.network-policies'
    case 'ServiceAccount':
      return 'access.service-accounts'
    case 'Role':
      return 'access.roles'
    case 'RoleBinding':
      return 'access.role-bindings'
    case 'ClusterRole':
      return 'access.cluster-roles'
    case 'ClusterRoleBinding':
      return 'access.cluster-role-bindings'
    case 'ConfigMap':
      return 'config.configmaps'
    case 'Secret':
      return 'config.secrets'
    case 'StorageClass':
      return 'storage.storage-classes'
    case 'PersistentVolume':
      return 'storage.persistent-volumes'
    case 'PersistentVolumeClaim':
      return 'storage.persistent-volume-claims'
    case 'CustomResourceDefinition':
      return 'custom.crds'
    case 'CustomResource':
      return 'custom.resources'
    case 'Pod':
    default:
      return 'workloads.pods'
  }
}
