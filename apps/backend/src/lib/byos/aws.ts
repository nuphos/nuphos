import { DescribeClusterCommand, EKSClient, ListClustersCommand } from '@aws-sdk/client-eks'

import { AppError } from '@/lib/errors'

import { extractAwsAccountId } from './account'
import { isAwsAccessDeniedError } from './aws-errors'
import { assumeRoleAsConnector, awsConnectorConfigured, getEnabledRegions } from './aws-sts'

import type { TempCredentials } from './aws-sts'
import type { ClusterResult } from './types'

export { EKS_TOKEN_TTL_MS, generateEksKubeconfig, getEksAdminAccess } from './aws-eks-access'
export type { EksAccessActor, EksAdminAccess } from './aws-eks-access'
export {
  assumeRoleAsConnector,
  assumeRoleWithWebIdentityForTeam,
  awsConnectorConfigured,
  cachedAwsAccountAlias,
  getAwsAccountAlias,
  getEnabledRegions,
  sanitizeSessionName,
} from './aws-sts'
export type { AssumeOptions, TempCredentials } from './aws-sts'

export type AwsListError = { region?: string; message: string }

export async function listEksClusters(
  roleArn: string,
): Promise<{ clusters: ClusterResult[]; errors: AwsListError[] }> {
  if (!awsConnectorConfigured()) {
    return {
      clusters: [],
      errors: [
        {
          message: 'AWS BYOS OIDC connector not configured (no signing key)',
        },
      ],
    }
  }

  const accountId = extractAwsAccountId(roleArn)

  if (!accountId) {
    return { clusters: [], errors: [{ message: 'Invalid roleArn (cannot extract account ID)' }] }
  }

  let temp: TempCredentials

  try {
    temp = await assumeRoleAsConnector(roleArn)
  } catch (e) {
    return { clusters: [], errors: [{ message: `AssumeRole failed: ${(e as Error).message}` }] }
  }

  let regions: string[]

  try {
    regions = await getEnabledRegions(accountId, temp)
  } catch (e) {
    return {
      clusters: [],
      errors: [{ message: `DescribeRegions failed: ${(e as Error).message}` }],
    }
  }

  const clusters: ClusterResult[] = []
  const errors: AwsListError[] = []
  const rawErrors: { region: string; error: unknown }[] = []

  await Promise.all(
    regions.map(async (region) => {
      try {
        const eks = new EKSClient({ region, credentials: temp })
        const list = await eks.send(new ListClustersCommand({}))
        const names = list.clusters ?? []
        const described = await Promise.all(
          names.map((name) => eks.send(new DescribeClusterCommand({ name }))),
        )

        for (const r of described) {
          const cl = r.cluster

          if (!cl?.name) continue
          clusters.push({
            provider: 'aws',
            name: cl.name,
            region,
            endpoint: cl.endpoint ?? undefined,
            caBase64: cl.certificateAuthority?.data ?? undefined,
            status: cl.status ?? undefined,
            version: cl.version ?? undefined,
            createdAt: cl.createdAt ?? undefined,
            awsRoleArn: roleArn,
            awsClusterArn: cl.arn ?? undefined,
          })
        }
      } catch (e) {
        rawErrors.push({ region, error: e })
        errors.push({ region, message: (e as Error).message })
      }
    }),
  )

  const accessDenied = rawErrors.find((entry) => isAwsAccessDeniedError(entry.error))

  if (clusters.length === 0 && accessDenied) {
    throw new AppError(
      403,
      'aws_role_permission_denied',
      'The selected AWS role does not have permission to eks:ListClusters.',
      {
        provider: 'aws',
        operation: 'eks:ListClusters',
        regions: rawErrors.map((entry) => entry.region),
        upstreamMessage:
          accessDenied.error instanceof Error
            ? accessDenied.error.message
            : String(accessDenied.error),
      },
    )
  }

  return { clusters, errors }
}
