import { generateAckKubeconfig, listAckClusters } from '@/lib/byos/aliyun'
import { generateAksKubeconfig, listAksClusters } from '@/lib/byos/azure'
import {
  aliyunHandleFor,
  azureHandleFor,
  linodeHandleFor,
  tencentHandleFor,
  volcengineHandleFor,
} from '@/lib/byos/handles'
import { getLkeKubeconfig, listLkeClusters } from '@/lib/byos/linode'
import { decryptOnpremKubeconfig } from '@/lib/byos/secrets'
import { generateTkeKubeconfig, listTkeClusters } from '@/lib/byos/tencent'
import { generateVkeKubeconfig, listVkeClusters } from '@/lib/byos/volcengine'
import { getVolcRegions } from '@/lib/byos/volcengine-ecs'

import { addRelayedContexts } from './sweep'

import type { ContextSink } from './sweep'
import type {
  AliyunAccountBinding,
  AzureAccountBinding,
  LinodeAccountBinding,
  OnpremClusterBinding,
  TencentAccountBinding,
  VolcengineAccountBinding,
} from '@/models'

export async function sweepTencent(opts: {
  binding: TencentAccountBinding
  account: string
  teamId: string
  sink: ContextSink
}): Promise<void> {
  const { binding, account, teamId, sink } = opts
  const handle = await tencentHandleFor(binding, teamId)
  const { clusters } = await listTkeClusters(handle)

  await addRelayedContexts({
    provider: 'tencent',
    account,
    teamId,
    sink,
    clusters: clusters.flatMap((cluster) =>
      cluster.tencentClusterId
        ? [
            {
              name: cluster.name,
              region: cluster.region,
              id: cluster.tencentClusterId,
              load: async () =>
                (await generateTkeKubeconfig(handle, cluster.region, cluster.tencentClusterId!))
                  ?.kubeconfig ?? null,
            },
          ]
        : [],
    ),
  })
}

export async function sweepAliyun(opts: {
  binding: AliyunAccountBinding
  account: string
  teamId: string
  sink: ContextSink
}): Promise<void> {
  const { binding, account, teamId, sink } = opts
  const handle = await aliyunHandleFor(binding, teamId)
  const { clusters } = await listAckClusters(handle)

  await addRelayedContexts({
    provider: 'aliyun',
    account,
    teamId,
    sink,
    clusters: clusters.flatMap((cluster) =>
      cluster.aliyunClusterId
        ? [
            {
              name: cluster.name,
              region: cluster.region,
              id: cluster.aliyunClusterId,
              load: async () =>
                (await generateAckKubeconfig(handle, cluster.region, cluster.aliyunClusterId!))
                  ?.kubeconfig ?? null,
            },
          ]
        : [],
    ),
  })
}

export async function sweepLinode(opts: {
  binding: LinodeAccountBinding
  account: string
  teamId: string
  sink: ContextSink
}): Promise<void> {
  const { binding, account, teamId, sink } = opts
  const handle = linodeHandleFor(binding)
  const clusters = await listLkeClusters(handle)

  await addRelayedContexts({
    provider: 'linode',
    account,
    teamId,
    sink,
    clusters: clusters.map((cluster) => ({
      name: cluster.label,
      region: cluster.region,
      id: String(cluster.id),
      load: () => getLkeKubeconfig(handle, cluster.id),
    })),
  })
}

export async function sweepVolcengine(opts: {
  binding: VolcengineAccountBinding
  account: string
  teamId: string
  sink: ContextSink
  fresh?: boolean
}): Promise<void> {
  const { binding, account, teamId, sink } = opts
  const handle = await volcengineHandleFor(binding, teamId)
  const { clusters } = await listVkeClusters(handle, await getVolcRegions(handle))

  await addRelayedContexts({
    provider: 'volcengine',
    account,
    teamId,
    sink,
    clusters: clusters.flatMap((cluster) =>
      cluster.volcengineClusterId
        ? [
            {
              name: cluster.name,
              region: cluster.region,
              id: cluster.volcengineClusterId,
              // VKE issues kubeconfigs per caller rather than handing back a
              // shared one, so the first sync of a cluster mints one. It is
              // reused on every later sync unless the caller asked for a fresh
              // credential — see the `fresh` note on collectAgentClusterContexts.
              load: async () =>
                (
                  await generateVkeKubeconfig(
                    handle,
                    cluster.region,
                    cluster.volcengineClusterId!,
                    {
                      fresh: opts.fresh,
                    },
                  )
                )?.kubeconfig ?? null,
            },
          ]
        : [],
    ),
  })
}

export async function sweepOnprem(opts: {
  binding: OnpremClusterBinding
  teamId: string
  sink: ContextSink
}): Promise<void> {
  const { binding, teamId, sink } = opts

  // Nothing to enumerate: an on-prem cluster is one cluster, and the
  // kubeconfig was handed to us at enrolment. It still goes through
  // addRelayedContexts so its context is named and de-duplicated exactly
  // like every provider's, and so an unusable credential (an exec stanza the
  // sandbox cannot run) is dropped the same way.
  await addRelayedContexts({
    provider: 'onprem',
    account: binding.label,
    teamId,
    sink,
    extra: { relayClusterKey: binding.clusterKey },
    clusters: [
      {
        name: 'cluster',
        region: 'onprem',
        id: binding.id.toHexString(),
        load: async () => decryptOnpremKubeconfig(binding.encryptedKubeconfig!),
      },
    ],
  })
}

export async function sweepAzure(opts: {
  binding: AzureAccountBinding
  account: string
  teamId: string
  sink: ContextSink
}): Promise<void> {
  const { binding, account, teamId, sink } = opts
  const handle = await azureHandleFor(binding, teamId)
  const { clusters } = await listAksClusters(handle)

  await addRelayedContexts({
    provider: 'azure',
    account,
    teamId,
    sink,
    clusters: clusters.flatMap((cluster) =>
      cluster.azureResourceGroup
        ? [
            {
              name: cluster.name,
              region: cluster.region,
              id: `${cluster.azureResourceGroup}-${cluster.name}`,
              // AAD-integrated clusters relay a kubelogin exec stanza, which the
              // sandbox can't run — parseRelayedKubeconfig drops those, so only
              // local-account clusters (self-contained client certificate) land
              // in the kubeconfig.
              load: async () =>
                (await generateAksKubeconfig(handle, cluster.azureResourceGroup!, cluster.name))
                  ?.kubeconfig ?? null,
            },
          ]
        : [],
    ),
  })
}
