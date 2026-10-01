// Minimal in-cluster Kubernetes REST client — just the namespaced CRUD the
// runtime provisioner needs, no SDK dependency. Writes go through server-side
// apply so repeated reconciles converge without read-modify-write.
import { existsSync, readFileSync } from 'node:fs'

import { execKubectl } from './kubectl-command'

import type { KubeObject } from './runtime-objects'

const SERVICE_ACCOUNT_DIR = '/var/run/secrets/kubernetes.io/serviceaccount'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type KubeResource = Pick<KubeObject, 'apiVersion' | 'kind' | 'metadata'>
export type KubeResourceState = {
  status?: { conditions?: { reason?: string }[] }
  metadata: { uid: string; deletionTimestamp?: string }
  spec?: {
    volumeName?: string
    persistentVolumeReclaimPolicy?: string
    claimRef?: { uid?: string }
    template?: {
      metadata?: { annotations?: Record<string, string> }
      spec?: { containers?: { name?: string; image?: string }[] }
    }
  }
}
export type KubeClient = {
  getResource?(resource: KubeResource): Promise<KubeResourceState | null>

  apply(resource: KubeObject, fieldManager: string): Promise<void>
  /** Atomically creates a resource, returning false when another replica won. */
  createIfAbsent(resource: KubeObject): Promise<boolean>
  getSecret(namespace: string, name: string): Promise<Record<string, string> | null>
  delete(resource: KubeResource, uid?: string): Promise<void>
}

function resourceCollectionPath(
  resource: Pick<KubeObject, 'apiVersion' | 'kind' | 'metadata'>,
): string {
  const prefix = resource.apiVersion.includes('/')
    ? `/apis/${resource.apiVersion}`
    : `/api/${resource.apiVersion}`
  const plural = `${resource.kind.toLowerCase()}s`

  const namespacePath = resource.metadata.namespace
    ? `/namespaces/${resource.metadata.namespace}`
    : ''

  return `${prefix}${namespacePath}/${plural}`
}

function resourcePath(resource: Pick<KubeObject, 'apiVersion' | 'kind' | 'metadata'>): string {
  return `${resourceCollectionPath(resource)}/${resource.metadata.name}`
}

export function createKubeClient(options: {
  baseUrl: string
  token: string
  ca?: string
  fetchImpl?: FetchLike
}): KubeClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? fetch
  const request = async (
    path: string,
    init: { method: string; contentType?: string; body?: string },
  ): Promise<Response> => {
    const headers: Record<string, string> = { Authorization: `Bearer ${options.token}` }

    if (init.contentType) headers['Content-Type'] = init.contentType

    return fetchImpl(`${options.baseUrl}${path}`, {
      method: init.method,
      signal: AbortSignal.timeout(30_000),
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      // Bun extension: pin the cluster CA instead of the system trust store.
      ...(options.ca ? { tls: { ca: options.ca } } : {}),
    })
  }

  return {
    async getResource(resource) {
      const response = await request(resourcePath(resource), { method: 'GET' })

      if (response.status === 404) return null
      if (!response.ok)
        throw new Error(`Kubernetes resource lookup failed (${String(response.status)})`)

      return (await response.json()) as KubeResourceState
    },
    async createIfAbsent(resource) {
      const response = await request(resourceCollectionPath(resource), {
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify(resource),
      })

      if (response.status === 409) return false
      if (!response.ok) {
        const detail = await response.text().catch(() => '')

        throw new Error(
          `kube create ${resource.kind}/${resource.metadata.name} failed (${String(response.status)}): ${detail.slice(0, 300)}`,
        )
      }

      return true
    },
    async apply(resource, fieldManager) {
      const path = `${resourcePath(resource)}?fieldManager=${fieldManager}&force=true`
      const response = await request(path, {
        method: 'PATCH',
        contentType: 'application/apply-patch+yaml',
        body: JSON.stringify(resource),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')

        throw new Error(
          `kube apply ${resource.kind}/${resource.metadata.name} failed (${String(response.status)}): ${detail.slice(0, 300)}`,
        )
      }
    },
    async getSecret(namespace, name) {
      const response = await request(`/api/v1/namespaces/${namespace}/secrets/${name}`, {
        method: 'GET',
      })

      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`kube get secret ${name} failed (${String(response.status)})`)
      }
      const body = (await response.json()) as { data?: Record<string, string> }

      return Object.fromEntries(
        Object.entries(body.data ?? {}).map(([key, value]) => [
          key,
          Buffer.from(value, 'base64').toString('utf8'),
        ]),
      )
    },
    async delete(resource, uid) {
      const response = await request(resourcePath(resource), {
        method: 'DELETE',
        contentType: 'application/json',
        body: JSON.stringify({
          propagationPolicy: 'Foreground',
          ...(uid ? { preconditions: { uid } } : {}),
        }),
      })

      if (!response.ok && response.status !== 404) {
        throw new Error(
          `kube delete ${resource.kind}/${resource.metadata.name} failed (${String(response.status)})`,
        )
      }
    },
  }
}

/**
 * Development client backed by the operator's own `kubectl` login — lets the
 * provisioner run against a real cluster from outside it. Never used in
 * production (gated in config).
 */
export function kubectlKubeClient(): KubeClient {
  return {
    async getResource(resource) {
      const output = await execKubectl([
        ...(resource.metadata.namespace ? ['-n', resource.metadata.namespace] : []),
        'get',
        resource.kind.toLowerCase(),
        resource.metadata.name,
        '-o',
        'json',
        '--ignore-not-found',
      ])

      return output.trim() ? (JSON.parse(output) as KubeResourceState) : null
    },
    async createIfAbsent(resource) {
      try {
        await execKubectl(['create', '-f', '-'], JSON.stringify(resource))

        return true
      } catch (err) {
        if (err instanceof Error && err.message.includes('AlreadyExists')) return false
        throw err
      }
    },
    async apply(resource, fieldManager) {
      await execKubectl(
        [
          'apply',
          '--server-side',
          `--field-manager=${fieldManager}`,
          '--force-conflicts',
          '-f',
          '-',
        ],
        JSON.stringify(resource),
      )
    },
    async getSecret(namespace, name) {
      try {
        const stdout = await execKubectl(['-n', namespace, 'get', 'secret', name, '-o', 'json'])
        const body = JSON.parse(stdout) as { data?: Record<string, string> }

        return Object.fromEntries(
          Object.entries(body.data ?? {}).map(([key, value]) => [
            key,
            Buffer.from(value, 'base64').toString('utf8'),
          ]),
        )
      } catch (err) {
        if (err instanceof Error && err.message.includes('NotFound')) return null
        throw err
      }
    },
    async delete(resource, uid) {
      if (uid) {
        // kubectl delete has no UID precondition flag. Use its authenticated
        // raw REST transport rather than a check-then-delete race.
        await execKubectl(
          ['delete', '--raw', resourcePath(resource), '-f', '-'],
          JSON.stringify({
            apiVersion: 'v1',
            kind: 'DeleteOptions',
            propagationPolicy: 'Foreground',
            preconditions: { uid },
          }),
        )

        return
      }
      await execKubectl([
        '-n',
        resource.metadata.namespace,
        'delete',
        resource.kind.toLowerCase(),
        resource.metadata.name,
        '--ignore-not-found',
      ])
    },
  }
}

/** Null outside a cluster — the provisioner then stays a no-op. */
export function inClusterKubeClient(): KubeClient | null {
  const tokenPath = `${SERVICE_ACCOUNT_DIR}/token`

  if (!existsSync(tokenPath)) return null

  return createKubeClient({
    baseUrl: 'https://kubernetes.default.svc',
    token: readFileSync(tokenPath, 'utf8').trim(),
    ca: readFileSync(`${SERVICE_ACCOUNT_DIR}/ca.crt`, 'utf8'),
  })
}
