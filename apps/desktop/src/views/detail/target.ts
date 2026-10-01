export type DetailTarget = {
  kind:
    | 'Pod'
    | 'Deployment'
    | 'Service'
    | 'Node'
    | 'ReplicaSet'
    | 'StatefulSet'
    | 'DaemonSet'
    | 'Job'
    | 'CronJob'
    | 'Ingress'
    | 'NetworkPolicy'
    | 'EndpointSlice'
    | 'ServiceAccount'
    | 'Role'
    | 'RoleBinding'
    | 'ClusterRole'
    | 'ClusterRoleBinding'
    | 'ConfigMap'
    | 'Secret'
    | 'PersistentVolume'
    | 'PersistentVolumeClaim'
    | 'StorageClass'
    | 'HelmRelease'
    | 'CustomResourceDefinition'
    | 'CustomResource'
  namespace: string | null
  name: string
  displayName?: string
  apiVersion?: string
  plural?: string
  resourceKind?: string
  uid?: string | null
  age?: string | null
  // Optional tab to open on (e.g. deep-linking a pod straight to 'Terminal').
  // Ignored if the tab doesn't exist for this kind.
  initialTab?: string
}

export function detailTargetKey(target: DetailTarget) {
  return [
    target.kind,
    target.namespace ?? '',
    target.name,
    target.displayName ?? '',
    target.apiVersion ?? '',
    target.plural ?? '',
    target.resourceKind ?? '',
    target.uid ?? '',
    target.age ?? '',
  ].join('\0')
}

// Identity of a getResourceYaml request — exactly the arguments the call takes,
// so a reset keyed on it stays in lockstep with the fetch effect's deps.
export function resourceYamlKey(context: string, target: DetailTarget) {
  return [
    context,
    target.kind,
    target.namespace ?? '',
    target.name,
    target.apiVersion ?? '',
    target.plural ?? '',
  ].join('\0')
}
