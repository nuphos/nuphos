import { stripPromptControlChars } from '@/lib/agent/prompt-text'

import type { AgentCredentialOptions } from './types'

type Options = AgentCredentialOptions

export function safePromptField(value: string): string {
  return stripPromptControlChars(value)
}

export function appendAwsRoleLines(lines: string[], awsRoles: Options['awsRoles'], teamId: string) {
  if (awsRoles.length === 0) return
  lines.push('', 'AWS roles:')
  for (const role of awsRoles) {
    const accountBase = `https://nuphos.ai/teams/${encodeURIComponent(teamId)}/infra/aws/${encodeURIComponent(role.accountId)}`
    const accountLabel = role.accountAlias
      ? `${role.accountAlias} (${role.accountId})`
      : role.accountId

    lines.push(
      `- accountId=${role.accountId}; roleId=${role.roleId}; roleArn=${role.roleArn}; accountLabel=${accountLabel}; setupCommand="bash skills/aws/scripts/setup-credentials.sh ${teamId} ${role.accountId} us-east-1 ${role.roleId}"; guiLinks={account:"${accountBase}", eksClusters:"${accountBase}/eks-clusters", ecsClusters:"${accountBase}/ecs-clusters", s3Buckets:"${accountBase}/s3-buckets"}; guiTemplates={eksCluster:"${accountBase}/clusters/<region>/<clusterName>", ecsServices:"${accountBase}/ecs-clusters/<region>/<clusterName>/services", ecsTasks:"${accountBase}/ecs-clusters/<region>/<clusterName>/tasks", ecsInfrastructure:"${accountBase}/ecs-clusters/<region>/<clusterName>/infrastructure", ecsMetrics:"${accountBase}/ecs-clusters/<region>/<clusterName>/metrics", s3Bucket:"${accountBase}/s3-buckets/<bucket>"}`,
    )
  }
}

export function appendGcpServiceAccountLines(
  lines: string[],
  gcpServiceAccounts: Options['gcpServiceAccounts'],
  teamId: string,
) {
  if (gcpServiceAccounts.length === 0) return
  lines.push('', 'GCP service accounts:')
  for (const account of gcpServiceAccounts) {
    const projectBase = `/teams/${teamId}/gcp-projects/${account.projectId}`
    const guiBase = `https://nuphos.ai/teams/${encodeURIComponent(teamId)}/infra/gcp/${encodeURIComponent(account.projectId)}`

    lines.push(
      `- projectId=${account.projectId}; serviceAccountId=${account.serviceAccountId}; serviceAccountEmail=${account.serviceAccountEmail}; setupCommand="bash skills/gcloud/scripts/setup-credentials.sh ${teamId} ${account.projectId} ${account.serviceAccountId}"; gceInstancesEndpoint="${projectBase}/gce-instances"; clustersEndpoint="${projectBase}/clusters"; vpcsEndpoint="${projectBase}/vpcs"; firewallsEndpoint="${projectBase}/firewalls"; guiLinks={gceInstances:"${guiBase}/gce-instances"}; guiTemplates={gceSsh:"${guiBase}/gce/<region>/instances/<instanceName>/ssh"}`,
    )
  }
}

export function appendOnpremClusterLines(
  lines: string[],
  clusters: Options['onpremClusters'],
  teamId: string,
) {
  if (clusters.length === 0) return
  lines.push(
    '',
    'On-prem Kubernetes clusters (each is a context in the kubeconfig `get_kubeconfig` returns; use its contextName):',
  )
  for (const cluster of clusters) {
    const guiBase = `https://nuphos.ai/teams/${encodeURIComponent(teamId)}/k8s/onprem/${encodeURIComponent(cluster.clusterId)}/onprem/${encodeURIComponent(cluster.clusterId)}/workloads/pods`

    lines.push(
      `- clusterId=${cluster.clusterId}; label=${safePromptField(cluster.label)}; contextName=${cluster.contextName}; guiLinks={cluster:"${guiBase}"}`,
    )
  }
}

export function appendDeviceLines(lines: string[], devices: Options['devices']) {
  if (devices.length === 0) return
  lines.push(
    '',
    'Local devices (pass `device="<deviceId>"` to local_exec to target one; omit it only when exactly one device is listed):',
  )
  for (const device of devices) {
    lines.push(
      `- deviceId=${device.deviceId}; label=${safePromptField(device.label)}; platform=${device.platform}`,
    )
  }
}

export function appendLinodeAccountLines(
  lines: string[],
  linodeAccounts: Options['linodeAccounts'],
  teamId: string,
) {
  if (linodeAccounts.length === 0) return
  lines.push('', 'Linode accounts:')
  for (const account of linodeAccounts) {
    lines.push(
      `- accountId=${account.accountId}; label=${account.label}; setupCommand="bash skills/linode/scripts/setup-credentials.sh ${teamId} ${account.accountId}"; instancesEndpoint="/teams/${teamId}/linode-accounts/${account.accountId}/instances"; lkeClustersEndpoint="/teams/${teamId}/linode-accounts/${account.accountId}/lke-clusters"`,
    )
  }
}

export function appendHetznerAccountLines(
  lines: string[],
  hetznerAccounts: Options['hetznerAccounts'],
  teamId: string,
) {
  if (hetznerAccounts.length === 0) return
  lines.push('', 'Hetzner accounts:')
  for (const account of hetznerAccounts) {
    lines.push(
      `- accountId=${account.accountId}; label=${account.label}; setupCommand="bash skills/hetzner/scripts/setup-credentials.sh ${teamId} ${account.accountId}"; serversEndpoint="/teams/${teamId}/hetzner-accounts/${account.accountId}/servers"`,
    )
  }
}

export function appendTencentAccountLines(
  lines: string[],
  tencentAccounts: Options['tencentAccounts'],
  teamId: string,
) {
  if (tencentAccounts.length === 0) return
  lines.push('', 'Tencent Cloud accounts:')
  for (const account of tencentAccounts) {
    const label = safePromptField(account.label)

    lines.push(
      `- accountId=${account.accountId}; label=${label}; roleArn=${account.roleArn}; setupCommand="bash skills/tencent/scripts/setup-credentials.sh ${teamId} ${account.accountId}"; clustersEndpoint="/teams/${teamId}/tencent-accounts/${account.accountId}/clusters"; cvmInstancesEndpoint="/teams/${teamId}/tencent-accounts/${account.accountId}/cvm-instances"`,
    )
  }
}

export function appendAliyunAccountLines(
  lines: string[],
  aliyunAccounts: Options['aliyunAccounts'],
  teamId: string,
) {
  if (aliyunAccounts.length === 0) return
  lines.push('', 'Aliyun accounts:')
  for (const account of aliyunAccounts) {
    const label = safePromptField(account.label)

    lines.push(
      `- accountId=${account.accountId}; label=${label}; roleArn=${account.roleArn}; setupCommand="bash skills/aliyun/scripts/setup-credentials.sh ${teamId} ${account.accountId}"; clustersEndpoint="/teams/${teamId}/aliyun-accounts/${account.accountId}/clusters"; ecsInstancesEndpoint="/teams/${teamId}/aliyun-accounts/${account.accountId}/ecs-instances"; swasInstancesEndpoint="/teams/${teamId}/aliyun-accounts/${account.accountId}/swas-instances"`,
    )
  }
}

export function appendVolcengineAccountLines(
  lines: string[],
  volcengineAccounts: Options['volcengineAccounts'],
  teamId: string,
) {
  if (volcengineAccounts.length === 0) return
  lines.push('', 'Volcengine accounts:')
  for (const account of volcengineAccounts) {
    const label = safePromptField(account.label)

    lines.push(
      `- accountId=${account.accountId}; label=${label}; roleTrn=${account.roleTrn}; setupCommand="bash skills/volcengine/scripts/setup-credentials.sh ${teamId} ${account.accountId}"; clustersEndpoint="/teams/${teamId}/volcengine-accounts/${account.accountId}/clusters"; ecsInstancesEndpoint="/teams/${teamId}/volcengine-accounts/${account.accountId}/ecs-instances"`,
    )
  }
}

export function appendAzureAccountLines(
  lines: string[],
  azureAccounts: Options['azureAccounts'],
  teamId: string,
) {
  if (azureAccounts.length === 0) return
  lines.push('', 'Azure subscriptions:')
  for (const account of azureAccounts) {
    const label = safePromptField(account.label)

    lines.push(
      `- accountId=${account.accountId}; label=${label}; subscriptionId=${account.subscriptionId}; setupCommand="bash skills/azure/scripts/setup-credentials.sh ${teamId} ${account.accountId}"; clustersEndpoint="/teams/${teamId}/azure-accounts/${account.accountId}/clusters"`,
    )
  }
}

export function appendHuaweiAccountLines(
  lines: string[],
  huaweiAccounts: Options['huaweiAccounts'],
  teamId: string,
) {
  if (huaweiAccounts.length === 0) return
  lines.push('', 'Huawei Cloud accounts:')
  for (const account of huaweiAccounts) {
    const label = safePromptField(account.label)

    lines.push(
      `- accountId=${account.accountId}; label=${label}; domainId=${account.domainId}; idpId=${account.idpId}; setupCommand="bash skills/huawei/scripts/setup-credentials.sh ${teamId} ${account.accountId}"`,
    )
  }
}

export function appendBetterStackIntegrationLines(
  lines: string[],
  betterStackIntegrations: Options['betterStackIntegrations'],
  teamId: string,
) {
  if (betterStackIntegrations.length === 0) return
  lines.push('', 'Better Stack integrations:')
  for (const integration of betterStackIntegrations) {
    lines.push(
      `- integrationId=${integration.integrationId}; label=${integration.label}; hasUptimeApiToken=${String(integration.hasUptimeApiToken)}; hasTelemetryApiToken=${String(integration.hasTelemetryApiToken)}; setupCommand="bash skills/betterstack/scripts/setup-credentials.sh ${teamId} ${integration.integrationId}"; monitorsEndpoint="/teams/${teamId}/betterstack-integrations/${integration.integrationId}/uptime/monitors"; sourcesEndpoint="/teams/${teamId}/betterstack-integrations/${integration.integrationId}/telemetry/sources"; collectorsEndpoint="/teams/${teamId}/betterstack-integrations/${integration.integrationId}/telemetry/collectors"`,
    )
  }
}

export function appendUptimeKumaInstanceLines(
  lines: string[],
  uptimeKumaInstances: Options['uptimeKumaInstances'],
  teamId: string,
) {
  if (uptimeKumaInstances.length === 0) return
  lines.push('', 'Uptime Kuma instances:')
  for (const instance of uptimeKumaInstances) {
    const base = `/teams/${teamId}/uptime-kuma-instances/${instance.instanceId}`
    const guiBase = `https://nuphos.ai/teams/${encodeURIComponent(teamId)}/infra/uptime-kuma/${encodeURIComponent(instance.instanceId)}`
    const label = safePromptField(instance.label)
    const baseUrl = safePromptField(instance.baseUrl)

    lines.push(
      `- instanceId=${instance.instanceId}; label=${label}; baseUrl=${baseUrl}; authType=${instance.authType}; monitorsEndpoint="${base}/monitors"; monitorEndpointTemplate="${base}/monitors/<monitorId>"; createMonitor="POST ${base}/monitors"; updateMonitor="PATCH ${base}/monitors/<monitorId>"; pauseMonitor="POST ${base}/monitors/<monitorId>/pause"; resumeMonitor="POST ${base}/monitors/<monitorId>/resume"; deleteMonitor="DELETE ${base}/monitors/<monitorId>"; guiLinks={monitors:"${guiBase}/monitors"}`,
    )
  }
}
