// Per-machine K8s API endpoint overrides.
//
// Some BYOS clusters enable a control-plane ACL: the provider-issued
// kubeconfig points at a public endpoint that rejects everything, and the
// only working ingress is the Tailscale operator's API server proxy
// (e.g. kube-apiserver-frontend-prod.tail8a6f3e.ts.net).
//
// The override describes how THIS machine reaches the cluster — different
// environments legitimately take different paths — so it lives in
// localStorage, never in the database.

const PREFIX = 'k8s-endpoint-override:'

function key(accountId: string, clusterId: number | string): string {
  return `${PREFIX}${accountId}:${String(clusterId)}`
}

// Hostname only (no scheme/path) — it gets embedded in a kubeconfig URL.
export function isValidOverrideHost(host: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)
}

export function getEndpointOverride(accountId: string, clusterId: number | string): string | null {
  try {
    return localStorage.getItem(key(accountId, clusterId))
  } catch {
    return null
  }
}

export function setEndpointOverride(
  accountId: string,
  clusterId: number | string,
  host: string | null,
): void {
  try {
    if (host) localStorage.setItem(key(accountId, clusterId), host)
    else localStorage.removeItem(key(accountId, clusterId))
  } catch {
    // localStorage can be unavailable in restricted environments.
  }
}
