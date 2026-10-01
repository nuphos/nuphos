import type { AgentCredentialOptions } from './types'

/**
 * A Kubernetes workspace tab is itself an explicit cluster choice. Include
 * that on-prem credential even when the desktop started the chat before its
 * async credential-options request finished. `options` has already been
 * member/allow-list filtered, so a forged context can never widen access.
 */
export function includeBoundOnpremCluster(
  selectedIds: string[],
  options: AgentCredentialOptions['onpremClusters'],
  kubeContext: string | undefined,
): string[] {
  const bound = kubeContext
    ? options.find((cluster) => cluster.contextName === kubeContext)
    : undefined

  if (!bound || selectedIds.includes(bound.clusterId)) return selectedIds

  return [...selectedIds, bound.clusterId]
}
