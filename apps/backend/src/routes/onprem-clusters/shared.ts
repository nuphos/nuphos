import { config } from '@/config'
import { parseRelayedKubeconfig } from '@/lib/byos/agent-kubeconfig'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { renderRelayInstallManifest } from '@/lib/byos/relay-install-manifest'
import { mintRelayAgentToken, relayConfigured } from '@/lib/byos/relay-token'
import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models'

import type { OnpremClusterBinding } from '@/models'
import type { ObjectId } from 'mongodb'

/** Mirrors AGENT_TOKEN_TTL_DAYS in relay-token.ts. */
const AGENT_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000

export function publicView(binding: OnpremClusterBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    endpoint: binding.endpoint ?? null,
    // Until a credential is supplied the cluster is reachable but invisible to
    // agent sessions; the UI needs to say which of the two it is.
    hasCredential: Boolean(binding.encryptedKubeconfig),
    contextName: `onprem/${binding.label}/cluster`,
    createdAt: binding.createdAt,
    tokenIssuedAt: binding.tokenIssuedAt,
    // Surfaced so a token ageing out is visible before the tunnel goes quiet:
    // the agent pod carries it for a year and nothing renews it in place.
    tokenExpiresAt: new Date(binding.tokenIssuedAt.getTime() + AGENT_TOKEN_TTL_MS),
  }
}

/**
 * The same gate the agent kubeconfig applies, enforced where the credential is
 * accepted so the failure is a clear error rather than a cluster that silently
 * never appears in a session.
 */
export function parseKubeconfigOrFail(kubeconfig: string): { endpoint: string } {
  const parsed = parseRelayedKubeconfig(kubeconfig)

  if (!parsed) {
    throw new AppError(
      400,
      'onprem_kubeconfig_unusable',
      'That kubeconfig is missing a server address, certificate-authority-data, or a token we can use. Use a persistent kubernetes.io/service-account-token Secret; kubectl create token credentials may expire after one hour.',
    )
  }

  return parsed
}

export function requireRelay(): void {
  if (relayConfigured()) return
  throw new AppError(
    503,
    'relay_not_configured',
    'On-prem clusters are not available on this deployment: the relay is not configured.',
  )
}

/** The one-time hand-off. The token is never readable again — only rotatable. */
export function installPayload(clusterKey: string): {
  agentEndpoint: string
  token: string
  manifest: string
} {
  const agentEndpoint = config.relay.agentEndpoint!
  const token = mintRelayAgentToken(clusterKey)

  return {
    agentEndpoint,
    token,
    manifest: renderRelayInstallManifest({ agentEndpoint, agentToken: token }),
  }
}

/**
 * Append a cluster to the team's bindings, returning false if the label is taken.
 *
 * Uniqueness is evaluated in the final Mongo write,
 * so concurrent enrolments cannot overrun either constraint.
 */
export async function appendCluster(
  teamId: ObjectId,
  binding: OnpremClusterBinding,
  now: Date,
): Promise<boolean> {
  return appendEnvironmentBinding(
    teamId,
    { 'onpremClusters.label': { $ne: binding.label } },
    { $push: { onpremClusters: binding }, $set: { updatedAt: now } },
  )
}

export async function loadBinding(
  teamId: ObjectId,
  clusterId: string,
): Promise<OnpremClusterBinding> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { onpremClusters: 1 } },
  )
  const binding = (doc?.onpremClusters ?? []).find((entry) => entry.id.toHexString() === clusterId)

  if (!binding) {
    throw new AppError(
      404,
      'onprem_cluster_not_found',
      'That on-prem cluster is not bound to this team.',
    )
  }

  return binding
}
