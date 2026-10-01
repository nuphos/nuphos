import type { KubernetesClusterProvider } from '../kubernetesClusterRoutes'

// ---------------------------------------------------------------------------
// Target types
// ---------------------------------------------------------------------------

export type MentionTarget =
  | { type: 'aws-account'; teamId: string; accountId: string }
  | { type: 'gcp-project'; teamId: string; projectId: string }
  | { type: 'cloudflare-account'; teamId: string; accountId: string }
  | { type: 'aws-vpc'; teamId: string; accountId: string; vpcId: string }
  | { type: 'gcp-vpc'; teamId: string; projectId: string; vpcId: string }
  | { type: 'aws-nacl'; teamId: string; accountId: string; naclId: string }
  | { type: 'aws-ec2'; teamId: string; accountId: string; instanceId: string }
  | {
      type: 'aws-lightsail'
      teamId: string
      accountId: string
      region: string
      name: string
    }
  | {
      type: 'aws-cfn'
      teamId: string
      accountId: string
      region: string
      stackName: string
    }
  | {
      type: 'aws-ecs-cluster'
      teamId: string
      accountId: string
      region: string
      clusterName: string
    }
  | {
      type: 'aws-s3'
      teamId: string
      accountId: string
      bucket: string
      key: string
      kind: 'bucket' | 'prefix' | 'object'
    }
  | { type: 'gcp-firewall'; teamId: string; projectId: string; name: string }
  | { type: 'cloudflare-zone'; teamId: string; accountId: string; zoneId: string }
  | {
      type: 'cloudflare-dns'
      teamId: string
      accountId: string
      zoneId: string
      recordId: string
    }
  | {
      type: 'cluster'
      teamId: string
      provider: KubernetesClusterProvider
      parentId: string
      region: string
      clusterName: string
    }
  | {
      type: 'k8s-resource'
      teamId: string
      provider: KubernetesClusterProvider
      parentId: string
      region: string
      clusterName: string
      namespace: string | null
      kind: string
      name: string
      apiVersion?: string
      plural?: string
      resourceKind?: string
    }
  | { type: 'github-installation'; teamId: string; installationId: string }
  | {
      type: 'github-repo'
      teamId: string
      installationId: string
      owner: string
      repo: string
    }
  | {
      type: 'github-pr'
      teamId: string
      installationId: string
      owner: string
      repo: string
      number: string
      /** The `?state=` the link was copied with; the list the PR page backs out to. */
      prState?: 'open' | 'closed' | 'all'
    }
  | {
      type: 'github-workflow-run'
      teamId: string
      installationId: string
      owner: string
      repo: string
      runId: string
    }
  | { type: 'grafana-instance'; teamId: string; instanceId: string }
  | {
      type: 'grafana-dashboard'
      teamId: string
      instanceId: string
      uid: string
    }
  | {
      type: 'grafana-datasource'
      teamId: string
      instanceId: string
      uid: string
      traceExplorer?: boolean
      logExplorer?: boolean
    }
  | {
      type: 'grafana-alert'
      teamId: string
      instanceId: string
      uid: string
    }
  | {
      type: 'monitoring-item'
      teamId: string
      provider: string
      integrationId: string
      kind: string
      resourceId: string
    }
  | { type: 'plan'; teamId: string; planId: string }
  | { type: 'agent-session'; teamId: string; sessionId: string }
