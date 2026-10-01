import type { MentionTarget } from './types.ts'

// ---------------------------------------------------------------------------
// Initial (sync) label, used until the async fetch resolves.
// ---------------------------------------------------------------------------

function titleCaseKind(kind: string): string {
  return kind.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function initialLabel(target: MentionTarget): string {
  switch (target.type) {
    case 'aws-account':
      return `AWS ${target.accountId}`
    case 'gcp-project':
      return `GCP ${target.projectId}`
    case 'cloudflare-account':
      return `Cloudflare ${target.accountId}`
    case 'aws-vpc':
    case 'gcp-vpc':
      return target.vpcId
    case 'aws-nacl':
      return target.naclId
    case 'aws-ec2':
      return target.instanceId
    case 'aws-lightsail':
      return target.name
    case 'aws-cfn':
      return target.stackName
    case 'aws-ecs-cluster':
      return target.clusterName
    case 'aws-s3': {
      if (target.kind === 'bucket') return target.bucket
      const trimmed = target.key.replace(/\/$/, '')
      const last = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed

      return last || target.bucket
    }
    case 'gcp-firewall':
      return target.name
    case 'cloudflare-zone':
      return target.zoneId
    case 'cloudflare-dns':
      return target.recordId
    case 'cluster':
      return target.clusterName
    case 'k8s-resource':
      return `${titleCaseKind(target.kind)} ${target.name}`
    case 'github-installation':
      return `Installation ${target.installationId}`
    case 'github-repo':
      return `${target.owner}/${target.repo}`
    case 'github-pr':
      return `${target.owner}/${target.repo} #${target.number}`
    case 'github-workflow-run':
      return `${target.owner}/${target.repo} run ${target.runId}`
    case 'grafana-instance':
      return `Grafana ${target.instanceId}`
    case 'grafana-dashboard':
    case 'grafana-datasource':
    case 'grafana-alert':
      return target.uid
    case 'monitoring-item':
      return target.resourceId
    case 'plan':
      return 'Plan'
    case 'agent-session':
      return 'Chat'
  }
}
