import { Sha256 } from '@aws-crypto/sha256-js'
import {
  AssociateAccessPolicyCommand,
  CreateAccessEntryCommand,
  DescribeClusterCommand,
  EKSClient,
  UpdateClusterConfigCommand,
} from '@aws-sdk/client-eks'
import { formatUrl } from '@aws-sdk/util-format-url'
import { HttpRequest } from '@smithy/protocol-http'
import { SignatureV4 } from '@smithy/signature-v4'

import { logEksAccessMutation } from './aws-eks-access-audit'
import { assumeRoleAsConnector } from './aws-sts'
import { renderKubeconfig } from './kubeconfig'

import type { EksAccessActor } from './aws-eks-access-audit'
import type { TempCredentials } from './aws-sts'
import type { KubeconfigResult } from './kubeconfig'

export type { EksAccessActor } from './aws-eks-access-audit'

export async function generateEksToken(
  clusterName: string,
  region: string,
  credentials: TempCredentials,
): Promise<string> {
  const hostname = `sts.${region}.amazonaws.com`
  const signer = new SignatureV4({
    credentials,
    region,
    service: 'sts',
    sha256: Sha256,
  })
  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname,
    path: '/',
    query: { Action: 'GetCallerIdentity', Version: '2011-06-15' },
    headers: { host: hostname, 'x-k8s-aws-id': clusterName },
  })
  const presigned = await signer.presign(request, {
    expiresIn: 900,
    signableHeaders: new Set(['host', 'x-k8s-aws-id']),
  })
  const url = formatUrl(presigned)

  return `k8s-aws-v1.${Buffer.from(url).toString('base64url')}`
}

const CLUSTER_ADMIN_POLICY_ARN =
  'arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy'
const ACCESS_PROPAGATION_DELAY_MS = 2000
const ENSURED_TTL_MS = 60 * 60 * 1000
const AUTH_MODE_UPGRADE_TIMEOUT_MS = 3 * 60 * 1000
const AUTH_MODE_POLL_INTERVAL_MS = 5000
const ensuredAccessCache = new Map<string, number>()

async function upgradeClusterAuthMode(
  eks: EKSClient,
  region: string,
  clusterName: string,
  principalArn: string,
  actor?: EksAccessActor,
): Promise<void> {
  const audit = { actor, region, clusterName, principalArn } as const

  try {
    const out = await eks.send(
      new UpdateClusterConfigCommand({
        name: clusterName,
        accessConfig: { authenticationMode: 'API_AND_CONFIG_MAP' },
      }),
    )

    logEksAccessMutation('byos.aws.eks.auth_mode_upgrade_requested', {
      ...audit,
      outcome: 'upgraded',
      response: out,
    })
  } catch (e) {
    const name = (e as { name?: string }).name

    if (name !== 'ResourceInUseException') {
      logEksAccessMutation('byos.aws.eks.auth_mode_upgrade_requested', {
        ...audit,
        outcome: 'failed',
        error: e,
      })
      throw e
    }
    logEksAccessMutation('byos.aws.eks.auth_mode_upgrade_requested', {
      ...audit,
      outcome: 'already_exists',
      error: e,
    })
  }

  const deadline = Date.now() + AUTH_MODE_UPGRADE_TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, AUTH_MODE_POLL_INTERVAL_MS))
    const out = await eks.send(new DescribeClusterCommand({ name: clusterName }))
    const mode = out.cluster?.accessConfig?.authenticationMode

    if (mode === 'API' || mode === 'API_AND_CONFIG_MAP') return
  }
  throw new Error(
    `Timed out after ${String(AUTH_MODE_UPGRADE_TIMEOUT_MS / 1000)}s waiting for ${clusterName} authentication mode upgrade`,
  )
}

async function ensureEksAccessEntry(
  eks: EKSClient,
  region: string,
  clusterName: string,
  principalArn: string,
  actor?: EksAccessActor,
): Promise<{ propagationNeeded: boolean }> {
  const key = `${region}|${clusterName}|${principalArn}`
  const cachedAt = ensuredAccessCache.get(key)

  if (cachedAt && Date.now() - cachedAt < ENSURED_TTL_MS) {
    return { propagationNeeded: false }
  }

  // Past this point every branch issues a real AWS mutation, so each one is
  // logged even when it is an idempotent no-op — CloudTrail records the call
  // (and monitoring alerts on it) regardless of the outcome.
  const audit = { actor, region, clusterName, principalArn } as const
  let propagationNeeded = false

  try {
    const out = await eks.send(
      new CreateAccessEntryCommand({ clusterName, principalArn, type: 'STANDARD' }),
    )

    propagationNeeded = true
    logEksAccessMutation('byos.aws.eks.access_entry_created', {
      ...audit,
      outcome: 'created',
      response: out,
    })
  } catch (e) {
    const failed = (e as { name?: string }).name !== 'ResourceInUseException'

    logEksAccessMutation('byos.aws.eks.access_entry_created', {
      ...audit,
      outcome: failed ? 'failed' : 'already_exists',
      error: e,
    })
    if (failed) throw e
  }

  try {
    const out = await eks.send(
      new AssociateAccessPolicyCommand({
        clusterName,
        principalArn,
        policyArn: CLUSTER_ADMIN_POLICY_ARN,
        accessScope: { type: 'cluster' },
      }),
    )

    logEksAccessMutation('byos.aws.eks.access_policy_associated', {
      ...audit,
      policyArn: CLUSTER_ADMIN_POLICY_ARN,
      outcome: 'associated',
      response: out,
    })
  } catch (e) {
    const msg = (e as Error).message ?? ''
    const failed = !/already/i.test(msg)

    logEksAccessMutation('byos.aws.eks.access_policy_associated', {
      ...audit,
      policyArn: CLUSTER_ADMIN_POLICY_ARN,
      outcome: failed ? 'failed' : 'already_exists',
      error: e,
    })
    if (failed) throw e
  }

  ensuredAccessCache.set(key, Date.now())

  return { propagationNeeded }
}

/**
 * How long callers may trust an EKS token: the presigned STS URL lives 15
 * minutes, minus a minute of clock-skew margin.
 */
export const EKS_TOKEN_TTL_MS = 14 * 60 * 1000

export type EksAdminAccess = {
  endpoint: string
  caBase64: string
  /** SigV4-presigned STS token (k8s-aws-v1.<base64url>). Cluster-admin via access entry. */
  adminToken: string
  clusterName: string
  region: string
}

/**
 * Resolve cluster + ensure connector role has cluster-admin access + mint a
 * cluster-admin token for kubeconfig routes.
 */
export async function getEksAdminAccess(
  roleArn: string,
  region: string,
  clusterName: string,
  actor?: EksAccessActor,
): Promise<EksAdminAccess | null> {
  const temp = await assumeRoleAsConnector(roleArn)
  const eks = new EKSClient({ region, credentials: temp })
  let cluster

  try {
    const out = await eks.send(new DescribeClusterCommand({ name: clusterName }))

    cluster = out.cluster
  } catch (e) {
    if ((e as { name?: string }).name === 'ResourceNotFoundException') return null
    throw e
  }
  if (!cluster) return null

  const mode = cluster.accessConfig?.authenticationMode

  if (mode !== 'API' && mode !== 'API_AND_CONFIG_MAP') {
    await upgradeClusterAuthMode(eks, region, clusterName, roleArn, actor)
    const out = await eks.send(new DescribeClusterCommand({ name: clusterName }))

    cluster = out.cluster
    if (!cluster) return null
  }

  if (!cluster.endpoint || !cluster.certificateAuthority?.data) {
    throw new Error('Cluster missing endpoint or CA certificate')
  }

  const { propagationNeeded } = await ensureEksAccessEntry(eks, region, clusterName, roleArn, actor)

  if (propagationNeeded) {
    await new Promise((resolve) => setTimeout(resolve, ACCESS_PROPAGATION_DELAY_MS))
  }

  const token = await generateEksToken(clusterName, region, temp)

  return {
    endpoint: cluster.endpoint,
    caBase64: cluster.certificateAuthority.data,
    adminToken: token,
    clusterName,
    region,
  }
}

export async function generateEksKubeconfig(
  roleArn: string,
  region: string,
  clusterName: string,
  actor?: EksAccessActor,
): Promise<KubeconfigResult | null> {
  const access = await getEksAdminAccess(roleArn, region, clusterName, actor)

  if (!access) return null
  const kubeconfig = renderKubeconfig({
    clusterName: access.clusterName,
    endpoint: access.endpoint,
    caBase64: access.caBase64,
    token: access.adminToken,
  })

  return { kubeconfig, expiresAt: new Date(Date.now() + EKS_TOKEN_TTL_MS) }
}
