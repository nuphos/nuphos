import { api } from '../../api'
import { listAlertRules, listDashboards } from '../../grafana/client'

import type { MentionTarget } from './types.ts'

// ---------------------------------------------------------------------------
// Async name resolution. Results are cached so repeated chips for the same
// URL don't refetch.
// ---------------------------------------------------------------------------

const labelCache = new Map<string, string>()
const pendingFetches = new Map<string, Promise<string | null>>()

export async function resolveMentionLabel(
  target: MentionTarget,
  cacheKey: string,
): Promise<string | null> {
  const cached = labelCache.get(cacheKey)

  if (cached) return cached
  const inflight = pendingFetches.get(cacheKey)

  if (inflight) return inflight
  const p = doResolve(target).then((label) => {
    pendingFetches.delete(cacheKey)
    if (label) labelCache.set(cacheKey, label)

    return label
  })

  pendingFetches.set(cacheKey, p)

  return p
}

async function doResolve(target: MentionTarget): Promise<string | null> {
  try {
    switch (target.type) {
      case 'aws-account': {
        const accounts = await api.atlasListAwsAccounts(target.teamId)
        const found = accounts.find((a) => a.accountId === target.accountId)

        return found?.alias || null
      }
      case 'gcp-project': {
        const projects = await api.atlasListGcpProjects(target.teamId)
        const found = projects.find((p) => p.projectId === target.projectId)

        return found?.alias || null
      }
      case 'cloudflare-account': {
        const accts = await api.atlasListCloudflareAccounts(target.teamId)
        const found = accts.find((a) => a.accountId === target.accountId)

        return found?.accountName || null
      }
      case 'aws-vpc': {
        const vpcs = await api.atlasListAwsVpcs(target.teamId, target.accountId)
        const found = vpcs.find((v) => v.id === target.vpcId)

        return found?.name || null
      }
      case 'gcp-vpc': {
        const vpcs = await api.atlasListGcpVpcs(target.teamId, target.projectId)
        const found = vpcs.find((v) => v.id === target.vpcId)

        return found?.name || null
      }
      case 'aws-ec2': {
        const list = await api.atlasListAwsEc2Instances(target.teamId, target.accountId)
        const found = list.find((i) => i.instanceId === target.instanceId)
        const nameTag = found?.tags?.Name

        return nameTag || null
      }
      case 'cloudflare-zone': {
        const zones = await api.atlasListCloudflareZones(target.teamId, target.accountId)
        const found = zones.find((z) => z.id === target.zoneId)

        return found?.name || null
      }
      case 'cloudflare-dns': {
        const records = await api.atlasListCloudflareDnsRecords(
          target.teamId,
          target.accountId,
          target.zoneId,
        )
        const found = records.find((r) => r.id === target.recordId)

        if (!found) return null

        return `${found.type} ${found.name}`
      }
      case 'github-installation': {
        const installs = await api.atlasListGithubInstallations(target.teamId)
        const found = installs.find((i) => String(i.installationId) === target.installationId)

        return found?.accountLogin || null
      }
      case 'grafana-instance': {
        const instances = await api.atlasListGrafanaInstances(target.teamId)
        const found = instances.find((i) => i.id === target.instanceId)

        return found?.name || null
      }
      case 'grafana-dashboard': {
        const dashboards = await listDashboards({
          teamId: target.teamId,
          instanceId: target.instanceId,
        })
        const found = dashboards.find((d) => d.uid === target.uid)

        return found?.title || null
      }
      case 'grafana-alert': {
        const rules = await listAlertRules({
          teamId: target.teamId,
          instanceId: target.instanceId,
        })
        const found = rules.find((r) => r.uid === target.uid)

        return found?.name || null
      }
      case 'monitoring-item': {
        const overview = await api.atlasGetMonitoringOverview(target.teamId)
        const found = overview.rows.find(
          (row) =>
            row.provider === target.provider &&
            row.integrationId === target.integrationId &&
            row.kind === target.kind &&
            row.providerResourceId === target.resourceId,
        )

        return found?.name || null
      }
      case 'plan': {
        const plan = await api.agentGetPlan(target.planId, target.teamId)
        const num = typeof plan.number === 'number' ? `#${String(plan.number)}` : ''

        return [`Plan ${num}`.trim(), plan.title].filter(Boolean).join(' · ')
      }
      case 'agent-session': {
        const conversation = await api.agentGetConversation(target.sessionId, target.teamId)

        return conversation.title || null
      }
      // No richer backend name to resolve — the parsed link already carries
      // everything the chip shows.
      case 'aws-nacl':
      case 'aws-lightsail':
      case 'aws-cfn':
      case 'aws-ecs-cluster':
      case 'aws-s3':
      case 'gcp-firewall':
      case 'cluster':
      case 'k8s-resource':
      case 'github-repo':
      case 'github-pr':
      case 'github-workflow-run':
      case 'grafana-datasource':
      default:
        return null
    }
  } catch {
    return null
  }
}
