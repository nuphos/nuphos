import { call } from './client'

import type { ClustersResponse } from './clusters'

export type TencentCvmInstance = {
  instanceId: string
  name: string
  instanceType: string
  state: string
  region: string
  zone: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  memoryGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
}

type TencentCvmListResponse = {
  instances: TencentCvmInstance[]
  errors: { region?: string; message: string }[]
}

export async function listTencentCvmInstances(
  teamId: string,
  accountId: string,
): Promise<TencentCvmInstance[]> {
  const data = await call<TencentCvmListResponse>(
    'GET',
    `/teams/${teamId}/tencent-accounts/${accountId}/cvm-instances`,
  )
  const instances = data.instances ?? []
  const errors = data.errors ?? []

  // Same partial-failure handling as the cluster scan: an empty list with errors
  // is a transient failure (keep loading), not a confirmed-empty account.
  if (instances.length === 0 && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Failed to list CVM instances')
  }
  if (errors.length > 0) {
    console.warn(
      `[tencent] CVM scan returned ${String(instances.length)} instances with ${String(errors.length)} region error(s):`,
      errors.map((e) => `${e.region ?? '?'}: ${e.message}`).join('; '),
    )
  }

  return instances
}

export async function listAliyunClusters(
  teamId: string,
  accountId: string,
): Promise<ClustersResponse['clusters']> {
  // Multi-region sweep like the TKE/VKE ones — same headroom.
  const data = await call<ClustersResponse>(
    'GET',
    `/teams/${teamId}/aliyun-accounts/${accountId}/clusters`,
    undefined,
    { timeoutMs: 30_000 },
  )
  const clusters = data.clusters ?? []
  const errors = data.errors ?? []

  // A 200 with no clusters BUT errors (e.g. a transient ACK rate-limit) is a
  // partial failure, not a confirmed-empty account. Throw so the UI keeps
  // cached rows / stays in loading instead of flashing "No items".
  if (clusters.length === 0 && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Failed to list ACK clusters')
  }
  if (errors.length > 0) {
    console.warn(
      `[aliyun] cluster scan returned ${String(clusters.length)} clusters with ${String(errors.length)} error(s):`,
      errors.map((e) => `${e.region ?? '?'}: ${e.message}`).join('; '),
    )
  }

  return clusters
}

// Aliyun ECS (Elastic Compute Service) server — the Alibaba Cloud analogue of
// EC2 / Tencent CVM. Same shape as TencentCvmInstance.
export type AliyunEcsInstance = {
  instanceId: string
  name: string
  instanceType: string
  state: string
  region: string
  zone: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  memoryGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
}

type AliyunEcsListResponse = {
  instances: AliyunEcsInstance[]
  errors: { region?: string; message: string }[]
}

// Aliyun Simple Application Server (SWAS) — the Alibaba analogue of Lightsail.
export type AliyunSwasInstance = {
  instanceId: string
  name: string
  plan: string
  status: string
  businessStatus: string | null
  region: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  memoryGb: number | null
  diskGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
  expiredAt: string | null
}

type AliyunSwasListResponse = {
  instances: AliyunSwasInstance[]
  errors: { region?: string; message: string }[]
}

export async function listAliyunSwasInstances(
  teamId: string,
  accountId: string,
): Promise<AliyunSwasInstance[]> {
  const data = await call<AliyunSwasListResponse>(
    'GET',
    `/teams/${teamId}/aliyun-accounts/${accountId}/swas-instances`,
    undefined,
    { timeoutMs: 30_000 },
  )
  const instances = data.instances ?? []
  const errors = data.errors ?? []

  // Same resilience contract as the ECS sweep: the backend hard-fails only when
  // no region is reachable, so a 200 with per-region errors means empty is real.
  if (errors.length > 0) {
    console.warn(
      `[aliyun] SWAS scan returned ${String(instances.length)} instances with ${String(errors.length)} region error(s):`,
      errors.map((e) => `${e.region ?? '?'}: ${e.message}`).join('; '),
    )
  }

  return instances
}

export async function listAliyunEcsInstances(
  teamId: string,
  accountId: string,
): Promise<AliyunEcsInstance[]> {
  const data = await call<AliyunEcsListResponse>(
    'GET',
    `/teams/${teamId}/aliyun-accounts/${accountId}/ecs-instances`,
    undefined,
    { timeoutMs: 30_000 },
  )
  const instances = data.instances ?? []
  const errors = data.errors ?? []

  // Unlike the ACK single-call list, ECS is a multi-region sweep: the backend
  // hard-fails (throws) only when it couldn't reach ANY region. A 200 that still
  // carries per-region errors means at least one region answered, so an empty
  // list is a real "no instances" — show it rather than throwing. Just log the
  // regions that flaked (e.g. one endpoint refused/timed out).
  if (errors.length > 0) {
    console.warn(
      `[aliyun] ECS scan returned ${String(instances.length)} instances with ${String(errors.length)} region error(s):`,
      errors.map((e) => `${e.region ?? '?'}: ${e.message}`).join('; '),
    )
  }

  return instances
}

export async function listVolcengineClusters(
  teamId: string,
  accountId: string,
): Promise<ClustersResponse['clusters']> {
  // VKE listing is a multi-region sweep on the backend; give it headroom.
  const data = await call<ClustersResponse>(
    'GET',
    `/teams/${teamId}/volcengine-accounts/${accountId}/clusters`,
    undefined,
    { timeoutMs: 30_000 },
  )
  const clusters = data.clusters ?? []
  const errors = data.errors ?? []

  // VKE listing is a multi-region sweep: the backend hard-fails (throws) only
  // when it couldn't reach ANY region, so a 200 with per-region errors means at
  // least one region answered and an empty list is a real "no clusters". Just
  // log the regions that flaked.
  if (errors.length > 0) {
    console.warn(
      `[volcengine] cluster scan returned ${String(clusters.length)} clusters with ${String(errors.length)} error(s):`,
      errors.map((e) => `${e.region ?? '?'}: ${e.message}`).join('; '),
    )
  }

  return clusters
}

// Volcengine ECS (Elastic Compute Service) server — the Volcengine analogue of
// EC2 / Tencent CVM / Aliyun ECS.
export type VolcengineEcsInstance = {
  instanceId: string
  name: string
  instanceType: string
  state: string
  region: string
  zone: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  memoryGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
}

type VolcengineEcsListResponse = {
  instances: VolcengineEcsInstance[]
  errors: { region?: string; message: string }[]
}

export async function listVolcengineEcsInstances(
  teamId: string,
  accountId: string,
): Promise<VolcengineEcsInstance[]> {
  const data = await call<VolcengineEcsListResponse>(
    'GET',
    `/teams/${teamId}/volcengine-accounts/${accountId}/ecs-instances`,
    undefined,
    { timeoutMs: 30_000 },
  )
  const instances = data.instances ?? []
  const errors = data.errors ?? []

  // Same resilience contract as the Aliyun ECS sweep: the backend hard-fails
  // only when no region is reachable, so a 200 with per-region errors means
  // empty is real. Just log the regions that flaked.
  if (errors.length > 0) {
    console.warn(
      `[volcengine] ECS scan returned ${String(instances.length)} instances with ${String(errors.length)} region error(s):`,
      errors.map((e) => `${e.region ?? '?'}: ${e.message}`).join('; '),
    )
  }

  return instances
}
