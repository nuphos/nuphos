import { call, callText } from './client'

export type OnpremCluster = {
  id: string
  label: string
  /** null until a credential is supplied — enrolment is deliberately tunnel-first. */
  endpoint: string | null
  hasCredential: boolean
  contextName: string
  createdAt?: string
  tokenIssuedAt?: string
  tokenExpiresAt?: string
}

/** Shown once, at enrolment or rotation — we keep no copy of the token. */
export type OnpremClusterInstall = {
  agentEndpoint: string
  token: string
  manifest: string
}

export type OnpremClusterConnection = {
  /** null when the relay itself could not be reached, which is our problem. */
  connected: boolean | null
  idleConnections: number | null
  lastSeenAt?: string | null
  agentVersion?: string | null
  reason?: string
}

export type OnpremClusterAccess = {
  reachable: boolean
  unreachableReason?: string
  serverVersion?: string
  identity?: { username: string; groups: string[] }
  namespaces?: { denied: true } | { denied: false; count: number; sample: string[] }
  permissions?: {
    namespace: string
    summary: string[]
    /** null when Kubernetes said the evaluation was incomplete — not "read-only". */
    canWrite: boolean | null
    incompleteReason?: string
  }
}

export async function listOnpremClusters(
  teamId: string,
): Promise<{ clusters: OnpremCluster[]; relayConfigured: boolean }> {
  return call<{ clusters: OnpremCluster[]; relayConfigured: boolean }>(
    'GET',
    `/teams/${teamId}/onprem-clusters`,
  )
}

export async function enrolOnpremCluster(
  teamId: string,
  label: string,
  // Omitted by the wizard: enrolment is tunnel-first, and the credential arrives
  // through setOnpremClusterKubeconfig once the agent has been seen connecting.
  kubeconfig?: string,
): Promise<{ cluster: OnpremCluster; install: OnpremClusterInstall }> {
  return call<{ cluster: OnpremCluster; install: OnpremClusterInstall }>(
    'POST',
    `/teams/${teamId}/onprem-clusters`,
    kubeconfig ? { label, kubeconfig } : { label },
  )
}

export async function onpremClusterConnection(
  teamId: string,
  clusterId: string,
): Promise<OnpremClusterConnection> {
  return call<OnpremClusterConnection>(
    'GET',
    `/teams/${teamId}/onprem-clusters/${clusterId}/connection`,
  )
}

export async function onpremClusterAccess(
  teamId: string,
  clusterId: string,
): Promise<OnpremClusterAccess> {
  return call<OnpremClusterAccess>('GET', `/teams/${teamId}/onprem-clusters/${clusterId}/access`)
}

export async function getOnpremClusterKubeconfig(
  teamId: string,
  clusterId: string,
): Promise<string> {
  return callText('GET', `/teams/${teamId}/onprem-clusters/${clusterId}/kubeconfig`)
}

export async function setOnpremClusterKubeconfig(
  teamId: string,
  clusterId: string,
  kubeconfig: string,
): Promise<{ cluster: OnpremCluster }> {
  return call<{ cluster: OnpremCluster }>(
    'PUT',
    `/teams/${teamId}/onprem-clusters/${clusterId}/kubeconfig`,
    { kubeconfig },
  )
}

export async function rotateOnpremClusterToken(
  teamId: string,
  clusterId: string,
): Promise<{ install: OnpremClusterInstall }> {
  return call<{ install: OnpremClusterInstall }>(
    'POST',
    `/teams/${teamId}/onprem-clusters/${clusterId}/rotate-token`,
  )
}

export async function deleteOnpremCluster(teamId: string, clusterId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/onprem-clusters/${clusterId}`)
}
