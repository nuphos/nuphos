export type Scope =
  | { kind: 'team'; teamId: string }
  | { kind: 'aws-account'; teamId: string; accountId: string; roleId?: string; roleArn?: string }
  | { kind: 'gcp-project'; teamId: string; projectId: string; serviceAccountId?: string }
  | { kind: 'cloudflare-account'; teamId: string; accountId: string }
  | { kind: 'linode-account'; teamId: string; accountId: string }
  | { kind: 'hetzner-account'; teamId: string; accountId: string }
  | { kind: 'tencent-account'; teamId: string; accountId: string }
  | { kind: 'aliyun-account'; teamId: string; accountId: string }
  | { kind: 'volcengine-account'; teamId: string; accountId: string }
  | { kind: 'azure-subscription'; teamId: string; subscriptionId: string; appId?: string }
  | { kind: 'betterstack-integration'; teamId: string; integrationId: string }
  | { kind: 'uptime-kuma-instance'; teamId: string; instanceId: string }
  // A bound database connection. Engine-agnostic: the connection record carries
  // its own engine, so PostgreSQL later reuses this scope with a different
  // sidebar provider key.
  | { kind: 'database-connection'; teamId: string; connectionId: string }
  | {
      kind: 'compliance-integration'
      teamId: string
      provider: 'secureframe' | 'vanta'
      integrationId: string
    }
  | { kind: 'tailscale-client'; teamId: string; clientId: string }
  | { kind: 'zeabur-provider'; teamId: string; zeaburId: string }
  | {
      kind: 'cloudflare-zone'
      teamId: string
      accountId: string
      zoneId: string
      zoneName: string
    }
  | {
      kind: 'cluster'
      teamId: string
      parentKind: 'aws-account' | 'gcp-project'
      parentId: string
      roleId?: string
      serviceAccountId?: string
      clusterName: string
      provider: 'aws' | 'gcp'
      region: string
      namespace?: string
    }
  | {
      kind: 'cluster'
      teamId: string
      parentKind: 'onprem-cluster'
      parentId: string
      roleId?: string
      serviceAccountId?: string
      clusterName: string
      provider: 'onprem'
      region: 'onprem'
      onpremClusterId: string
      namespace?: string
    }
  | {
      kind: 'cluster'
      teamId: string
      parentKind: 'linode-account'
      parentId: string
      roleId?: string
      serviceAccountId?: string
      clusterName: string
      provider: 'linode'
      region: string
      linodeClusterId: number
      namespace?: string
    }
  | {
      kind: 'cluster'
      teamId: string
      parentKind: 'tencent-account'
      parentId: string
      // Unused for Tencent, kept to match the other cluster variants' shape so
      // the shared scope.roleId / scope.serviceAccountId accessors typecheck.
      roleId?: string
      serviceAccountId?: string
      clusterName: string
      provider: 'tencent'
      region: string
      tencentClusterId: string
      namespace?: string
    }
  | {
      kind: 'cluster'
      teamId: string
      parentKind: 'aliyun-account'
      parentId: string
      // Unused for Aliyun, kept to match the other cluster variants' shape so
      // the shared scope.roleId / scope.serviceAccountId accessors typecheck.
      roleId?: string
      serviceAccountId?: string
      clusterName: string
      provider: 'aliyun'
      region: string
      aliyunClusterId: string
      namespace?: string
    }
  | {
      kind: 'cluster'
      teamId: string
      parentKind: 'volcengine-account'
      parentId: string
      // Unused for Volcengine, kept to match the other cluster variants' shape
      // so the shared scope.roleId / scope.serviceAccountId accessors typecheck.
      roleId?: string
      serviceAccountId?: string
      clusterName: string
      provider: 'volcengine'
      region: string
      volcengineClusterId: string
      namespace?: string
    }
  | {
      kind: 'aws-ecs-cluster'
      teamId: string
      accountId: string
      roleId?: string
      region: string
      clusterName: string
      clusterArn: string
      capacityProviders?: string[]
    }

export type AccountSidebarKey =
  | 'aws.overview'
  | 'aws.vpcs'
  | 'aws.nacls'
  | 'aws.clusters'
  | 'aws.ec2'
  | 'aws.lightsail'
  | 'aws.ecs'
  | 'aws.cloudformation'
  | 'ecs.services'
  | 'ecs.tasks'
  | 'ecs.infrastructure'
  | 'ecs.metrics'
  | 'gcp.overview'
  | 'gcp.vpcs'
  | 'gcp.firewalls'
  | 'gcp.clusters'
  | 'cloudflare.zones'
  | 'cloudflare.dns'
  | 'betterstack.monitors'
  | 'betterstack.incidents'
  | 'betterstack.sources'
  | 'betterstack.dashboards'
  | 'uptime-kuma.monitors'
  | 'zeabur.projects'
  | 'zeabur.servers'

export type SidebarKey =
  | 'cluster.events'
  | 'cluster.overview'
  | 'cluster.nodes'
  | 'helm.releases'
  | 'workloads.deployments'
  | 'workloads.pods'
  | 'workloads.replicasets'
  | 'workloads.statefulsets'
  | 'workloads.daemonsets'
  | 'workloads.jobs'
  | 'workloads.cronjobs'
  | 'networking.services'
  | 'networking.ingresses'
  | 'networking.endpoint-slices'
  | 'networking.network-policies'
  | 'access.service-accounts'
  | 'access.roles'
  | 'access.role-bindings'
  | 'access.cluster-roles'
  | 'access.cluster-role-bindings'
  | 'config.configmaps'
  | 'config.secrets'
  | 'storage.storage-classes'
  | 'storage.persistent-volumes'
  | 'storage.persistent-volume-claims'
  | 'custom.crds'
  | 'custom.resources'

export type PortForwardInfo = {
  id: string
  context: string
  namespace: string
  podName: string
  targetPort: number
  localPort: number
  startedAt: string
}

export type PortForwardEvent = {
  type: 'started' | 'stopped' | 'error'
  info: PortForwardInfo
  error?: string
}
