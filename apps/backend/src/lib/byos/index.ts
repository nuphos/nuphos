import { extractAwsAccountId } from './account'
import {
  listAckClusters,
  generateAckKubeconfig,
  assumeRoleWithOidc as assumeAliyunRoleWithOidc,
} from './aliyun'
import { listEksClusters, generateEksKubeconfig } from './aws'
import { listAksClusters, generateAksKubeconfig, assumeAzureViaOidc } from './azure'
import { listGkeClusters, generateGkeKubeconfig } from './gcp'
import { listTkeClusters, generateTkeKubeconfig, assumeRoleWithWebIdentity } from './tencent'
import { listVkeClusters, generateVkeKubeconfig, assumeRoleWithOidc } from './volcengine'
import { getVolcRegions } from './volcengine-ecs'

import type { BindingError, ListClustersResult } from './types'
import type { TeamByosBindings } from '@/models'

export async function listClustersForTeam(
  doc: TeamByosBindings | null,
): Promise<ListClustersResult> {
  if (!doc) return { clusters: [], errors: [] }

  const awsTasks = (doc.awsRoles ?? []).map(async (b) => {
    const accountId = extractAwsAccountId(b.roleArn) ?? undefined
    const { clusters, errors } = await listEksClusters(b.roleArn)

    return {
      clusters,
      errors: errors.map<BindingError>((e) => ({
        provider: 'aws',
        ...(accountId !== undefined && { accountId }),
        ...(e.region !== undefined && { region: e.region }),
        message: e.message,
      })),
    }
  })

  const gcpTasks = (doc.gcpServiceAccounts ?? []).map(async (b) => {
    const { clusters, errors } = await listGkeClusters({
      serviceAccountEmail: b.serviceAccountEmail,
      projectId: b.projectId,
      teamId: doc._id.toHexString(),
    })

    return {
      clusters,
      errors: errors.map<BindingError>((e) => ({
        provider: 'gcp',
        projectId: b.projectId,
        message: e.message,
      })),
    }
  })

  const tencentTasks = (doc.tencentAccounts ?? []).map(async (b) => {
    const accountId = b.id.toHexString()
    const teamId = doc._id.toHexString()

    try {
      // Guard pre-OIDC bindings (removed by the startup migration, but a stale
      // one would otherwise call STS with an undefined role and get an opaque
      // Tencent error). Mirrors the route helper `tencentHandleFor`.
      if (!b.roleArn || !b.providerId) {
        throw new Error(
          'This Tencent binding predates the OIDC migration. Remove it and re-bind with a CAM role.',
        )
      }
      // OIDC web-identity federation: mint a per-team token and assume the
      // customer's CAM role for short-lived STS creds. Legacy bindings predate
      // the partition field — treat them as China.
      const handle = await assumeRoleWithWebIdentity(b.roleArn, b.providerId, teamId, {
        site: b.site ?? 'china',
        sessionName: `nuphos-list-${accountId}`,
      })
      const { clusters, errors } = await listTkeClusters(handle)

      return {
        // Stamp the binding id so callers can map a cluster back to its creds.
        clusters: clusters.map((cl) => ({ ...cl, tencentAccountId: accountId })),
        errors: errors.map<BindingError>((e) => ({
          provider: 'tencent' as const,
          accountId,
          ...(e.region !== undefined && { region: e.region }),
          message: e.message,
        })),
      }
    } catch (e) {
      return {
        clusters: [],
        errors: [{ provider: 'tencent' as const, accountId, message: (e as Error).message }],
      }
    }
  })

  const aliyunTasks = (doc.aliyunAccounts ?? []).map(async (b) => {
    const accountId = b.id.toHexString()
    const teamId = doc._id.toHexString()

    try {
      // OIDC web-identity federation: mint a per-team token and assume the
      // customer's RAM role for short-lived STS creds. Legacy bindings predate
      // the partition field — treat them as China.
      const handle = await assumeAliyunRoleWithOidc(b.roleArn, b.oidcProviderArn, teamId, {
        site: b.site ?? 'china',
        sessionName: `nuphos-list-${accountId}`,
      })
      const { clusters, errors } = await listAckClusters(handle)

      return {
        clusters: clusters.map((cl) => ({ ...cl, aliyunAccountId: accountId })),
        errors: errors.map<BindingError>((e) => ({
          provider: 'aliyun' as const,
          accountId,
          ...(e.region !== undefined && { region: e.region }),
          message: e.message,
        })),
      }
    } catch (e) {
      return {
        clusters: [],
        errors: [{ provider: 'aliyun' as const, accountId, message: (e as Error).message }],
      }
    }
  })

  const volcengineTasks = (doc.volcengineAccounts ?? []).map(async (b) => {
    const accountId = b.id.toHexString()
    const teamId = doc._id.toHexString()

    try {
      // OIDC web-identity federation: mint a per-team token and assume the
      // customer's role for short-lived creds.
      const handle = await assumeRoleWithOidc(b.roleTrn, teamId, {
        sessionName: `nuphos-list-${accountId}`,
      })
      const regions = await getVolcRegions(handle)
      const { clusters, errors } = await listVkeClusters(handle, regions)

      return {
        clusters: clusters.map((cl) => ({ ...cl, volcengineAccountId: accountId })),
        errors: errors.map<BindingError>((e) => ({
          provider: 'volcengine' as const,
          accountId,
          ...(e.region !== undefined && { region: e.region }),
          message: e.message,
        })),
      }
    } catch (e) {
      return {
        clusters: [],
        errors: [{ provider: 'volcengine' as const, accountId, message: (e as Error).message }],
      }
    }
  })

  const azureTasks = (doc.azureAccounts ?? []).map(async (b) => {
    const accountId = b.id.toHexString()
    const teamId = doc._id.toHexString()

    try {
      // OIDC workload identity federation: mint a per-team token and exchange it
      // for a short-lived ARM access token, then list the subscription's AKS
      // clusters.
      const handle = await assumeAzureViaOidc(
        { tenantId: b.tenantId, clientId: b.clientId, subscriptionId: b.subscriptionId },
        teamId,
      )
      const { clusters, errors } = await listAksClusters(handle)

      return {
        clusters: clusters.map((cl) => ({ ...cl, azureAccountId: accountId })),
        errors: errors.map<BindingError>((e) => ({
          provider: 'azure' as const,
          accountId,
          message: e.message,
        })),
      }
    } catch (e) {
      return {
        clusters: [],
        errors: [{ provider: 'azure' as const, accountId, message: (e as Error).message }],
      }
    }
  })

  const all = await Promise.all([
    ...awsTasks,
    ...gcpTasks,
    ...tencentTasks,
    ...aliyunTasks,
    ...volcengineTasks,
    ...azureTasks,
  ])

  return {
    clusters: all.flatMap((r) => r.clusters),
    errors: all.flatMap((r) => r.errors),
  }
}

export {
  generateEksKubeconfig,
  generateGkeKubeconfig,
  generateTkeKubeconfig,
  generateAckKubeconfig,
  generateVkeKubeconfig,
  generateAksKubeconfig,
}
export type { KubeconfigResult } from './kubeconfig'
export type { ClusterResult, ListClustersResult, BindingError } from './types'
