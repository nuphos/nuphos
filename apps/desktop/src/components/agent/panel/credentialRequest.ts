import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'

/**
 * Keep the first request least-privileged while credential options load. An
 * explicit empty selection prevents the backend from expanding it to every
 * available credential; the current Kubernetes workspace context is still
 * added server-side after its permission-filtered options resolve.
 */
export function newConversationCredentialAccessForRequest(
  access: AgentCredentialSelection,
): AgentCredentialSelection {
  return access
}

/**
 * The cluster open in the Kubernetes workspace is an explicit user choice.
 * Reflect it in the selector and turn request once the permission-filtered
 * options arrive. The backend applies the same rule as a race-safe fallback.
 */
export function includeBoundOnpremCredential(
  access: AgentCredentialSelection,
  options: AgentCredentialOptions,
  kubeContext: string | null | undefined,
): AgentCredentialSelection {
  const bound = kubeContext
    ? options.onpremClusters.find((cluster) => cluster.contextName === kubeContext)
    : undefined

  if (!bound || access.onpremClusterIds.includes(bound.clusterId)) return access

  return {
    ...access,
    onpremClusterIds: [...access.onpremClusterIds, bound.clusterId],
  }
}
