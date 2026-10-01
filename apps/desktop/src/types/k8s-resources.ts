export type IngressItem = {
  namespace: string
  name: string
  class: string
  hosts: string[]
  addresses: string[]
  age: string | null
}

export type NetworkPolicyItem = {
  namespace: string
  name: string
  pod_selector: string
  policy_types: string[]
  ingress_rules: number
  egress_rules: number
  age: string | null
}

export type EndpointSliceItem = {
  namespace: string
  name: string
  address_type: string
  ports: string[]
  endpoints: number
  ready: number
  service_name: string | null
  age: string | null
}

export type ServiceAccountItem = {
  namespace: string
  name: string
  secrets: number
  image_pull_secrets: number
  age: string | null
}

export type RoleItem = {
  namespace: string
  name: string
  rules: number
  resources: string[]
  verbs: string[]
  rule_summaries: string[]
  age: string | null
}

export type ClusterRoleItem = Omit<RoleItem, 'namespace'>

export type RoleBindingItem = {
  namespace: string
  name: string
  role_ref: string
  subjects: string[]
  age: string | null
}

export type ClusterRoleBindingItem = Omit<RoleBindingItem, 'namespace'>

export type ConfigMapItem = {
  namespace: string
  name: string
  keys: number
  keyNames: string[]
  immutable: boolean
  age: string | null
}

export type SecretItem = {
  namespace: string
  name: string
  type: string
  keys: number
  keyNames: string[]
  age: string | null
}

export type PersistentVolumeItem = {
  name: string
  capacity: string | null
  access_modes: string[]
  reclaim_policy: string
  status: string
  claim: string | null
  storage_class: string | null
  age: string | null
}

export type PersistentVolumeClaimItem = {
  namespace: string
  name: string
  status: string
  volume: string | null
  capacity: string | null
  access_modes: string[]
  storage_class: string | null
  age: string | null
}

export type StorageClassItem = {
  name: string
  provisioner: string
  reclaim_policy: string
  volume_binding_mode: string
  is_default: boolean
  age: string | null
}

export type HelmReleaseItem = {
  namespace: string
  name: string
  revision: string
  status: string
  chart: string
  app_version: string
  storage_kind: 'Secret' | 'ConfigMap'
  storage_name: string
  age: string | null
}

export type CustomResourceDefinitionItem = {
  name: string
  group: string
  kind: string
  plural: string
  scope: string
  versions: string[]
  served_version: string | null
  stored_versions: string[]
  age: string | null
}

export type CustomResourceItem = {
  apiVersion: string
  kind: string
  plural: string
  namespaced: boolean
  namespace: string | null
  name: string
  uid: string | null
  status: string
  age: string | null
}

export type CustomResourceType = {
  apiVersion: string
  kind: string
  plural: string
  namespaced: boolean
}
