import { provisionerKubeClient } from './provisioner-kube'
import { runtimeAuthSecretName } from './runtime-objects'

import type { KubeClient } from './kube-client'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

export const RUNTIME_AUTH_SECRET_KEY = 'OPENAB_ACP_AUTH_KEY'

function runtimeSecretStoreFailure(error: unknown): never {
  if (error instanceof AppError) throw error

  const wrapped = new AppError(
    503,
    'runtime_secret_store_unavailable',
    'The runtime credential store is unavailable. Verify Kubernetes Secret access for the backend ServiceAccount.',
  )

  wrapped.cause = error
  throw wrapped
}

/**
 * The runtime Secret is a derived artifact that runtime pods read; Mongo owns
 * the transport key. With no Kubernetes connection there is no pod to serve,
 * so every call here reports "nothing there" instead of failing the request.
 */
export async function readRuntimeAuthSecret(
  teamId: string,
  runtimeId: string,
  kube: KubeClient | null = provisionerKubeClient(),
  namespace = config.claudeCodeRuntimeProvisioner.namespace,
): Promise<string | null> {
  if (!kube) return null
  try {
    const secret = await kube.getSecret(namespace, runtimeAuthSecretName(teamId, runtimeId))

    return secret?.[RUNTIME_AUTH_SECRET_KEY] ?? null
  } catch (error) {
    runtimeSecretStoreFailure(error)
  }
}

/** Dedicated operator credential; never fall back to ordinary chat authentication. */
export async function readRuntimeControlSecret(
  teamId: string,
  runtimeId: string,
  kube: KubeClient | null = provisionerKubeClient(),
  namespace = config.claudeCodeRuntimeProvisioner.namespace,
): Promise<string | null> {
  if (!kube) return null
  try {
    const secret = await kube.getSecret(namespace, runtimeAuthSecretName(teamId, runtimeId))

    return secret?.OPENAB_ACP_CONTROL_KEY ?? null
  } catch (error) {
    runtimeSecretStoreFailure(error)
  }
}

export async function deleteRuntimeAuthSecret(
  teamId: string,
  runtimeId: string,
  kube: KubeClient | null = provisionerKubeClient(),
  namespace = config.claudeCodeRuntimeProvisioner.namespace,
): Promise<void> {
  if (!kube) return
  try {
    await kube.delete({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: runtimeAuthSecretName(teamId, runtimeId), namespace },
    })
  } catch (error) {
    runtimeSecretStoreFailure(error)
  }
}
