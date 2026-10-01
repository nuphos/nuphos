import { listEksClusters } from '@/lib/byos/aws'
import { listGkeClusters } from '@/lib/byos/gcp'

import { claimContextName } from './sweep'

import type { ContextSink } from './sweep'
import type { AwsRoleBinding, GcpServiceAccountBinding } from '@/models'

export async function sweepAws(opts: {
  accountId: string
  binding: AwsRoleBinding
  teamId: string
  sink: ContextSink
}): Promise<void> {
  const { accountId, binding, teamId, sink } = opts
  const { clusters } = await listEksClusters(binding.roleArn)

  for (const cluster of clusters) {
    if (!cluster.endpoint || !cluster.caBase64) continue
    const contextName = claimContextName(sink, [
      `aws/${accountId}/${cluster.name}`,
      `aws/${accountId}/${cluster.name}@${cluster.region}`,
    ])

    if (!contextName) continue
    sink.contexts.push({
      contextName,
      endpoint: cluster.endpoint,
      caBase64: cluster.caBase64,
      execArgs: ['aws', teamId, accountId, cluster.name, cluster.region],
    })
  }
}

export async function sweepGcp(opts: {
  binding: GcpServiceAccountBinding
  teamId: string
  sink: ContextSink
}): Promise<void> {
  const { binding, teamId, sink } = opts
  const { clusters } = await listGkeClusters({
    projectId: binding.projectId,
    serviceAccountEmail: binding.serviceAccountEmail,
    teamId,
  })

  for (const cluster of clusters) {
    if (!cluster.endpoint || !cluster.caBase64) continue
    const contextName = claimContextName(sink, [
      `gcp/${binding.projectId}/${cluster.name}`,
      `gcp/${binding.projectId}/${cluster.name}@${cluster.region}`,
    ])

    if (!contextName) continue
    sink.contexts.push({
      contextName,
      endpoint: cluster.endpoint.startsWith('https://')
        ? cluster.endpoint
        : `https://${cluster.endpoint}`,
      caBase64: cluster.caBase64,
      execArgs: ['gcp', teamId, binding.projectId, cluster.name, cluster.region],
    })
  }
}
