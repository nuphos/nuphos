import { decryptSonarqubeSecret } from './secrets'
import {
  pinnedNodeRequest,
  resolvePublicSonarqubeTarget,
  SonarqubeApiError,
} from './sonarqube-network'

import type { PinnedRequestInput, SonarqubeResolvedTarget } from './sonarqube-network'
import type { SonarqubeIntegrationBinding } from '@/models'

const REQUEST_TIMEOUT_MS = 30_000

export type SonarqubeCredentials = {
  baseUrl: string
  token: string
}

export type SonarqubeRequestDependencies = {
  resolveTarget: (baseUrl: string) => Promise<SonarqubeResolvedTarget>
  request: (input: PinnedRequestInput) => Promise<Response>
}

export const defaultRequestDependencies: SonarqubeRequestDependencies = {
  resolveTarget: resolvePublicSonarqubeTarget,
  request: pinnedNodeRequest,
}

export function credentialsFromSonarqubeBinding(
  binding: SonarqubeIntegrationBinding,
): SonarqubeCredentials {
  return {
    baseUrl: binding.baseUrl,
    token: decryptSonarqubeSecret(binding.encryptedToken),
  }
}

function upstreamUrl(baseUrl: string, path: string, query?: URLSearchParams): string {
  const base = baseUrl.replace(/\/$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const suffix = query && query.size > 0 ? `?${query.toString()}` : ''

  return `${base}${normalizedPath}${suffix}`
}

async function parseResponse(res: Response): Promise<unknown> {
  const text = await res.text()

  if (!text) return null
  const type = res.headers.get('content-type') ?? ''

  if (type.includes('application/json')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return text
}

export async function sonarqubeRequest<T>(
  credentials: SonarqubeCredentials,
  path: string,
  options: {
    method?: 'GET' | 'POST'
    query?: URLSearchParams
    body?: URLSearchParams
  } = {},
  dependencies: SonarqubeRequestDependencies = defaultRequestDependencies,
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${credentials.token}`,
  })

  if (options.body) headers.set('Content-Type', 'application/x-www-form-urlencoded')
  let res: Response

  try {
    const target = await dependencies.resolveTarget(credentials.baseUrl)

    res = await dependencies.request({
      url: new URL(upstreamUrl(credentials.baseUrl, path, options.query)),
      method: options.method ?? 'GET',
      headers,
      body: options.body?.toString(),
      signal: controller.signal,
      target,
    })
  } catch (err) {
    if (err instanceof SonarqubeApiError) throw err
    const detail = err instanceof Error ? err.message : String(err)

    throw new SonarqubeApiError(`Could not reach SonarQube: ${detail}`, 0, path)
  } finally {
    clearTimeout(timeout)
  }

  const payload = await parseResponse(res)

  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && 'errors' in payload
        ? JSON.stringify((payload as { errors: unknown }).errors)
        : typeof payload === 'string'
          ? payload.slice(0, 500)
          : `SonarQube returned HTTP ${String(res.status)}`

    throw new SonarqubeApiError(message, res.status, path, payload)
  }

  return payload as T
}

export async function verifySonarqubeCredentials(
  credentials: SonarqubeCredentials,
  dependencies: SonarqubeRequestDependencies = defaultRequestDependencies,
): Promise<{ version: string | null }> {
  const validation = await sonarqubeRequest<{ valid?: boolean }>(
    credentials,
    '/api/authentication/validate',
    {},
    dependencies,
  )

  if (validation.valid !== true) {
    throw new SonarqubeApiError(
      'The SonarQube token is invalid or lacks access.',
      401,
      '/api/authentication/validate',
    )
  }
  const version = await sonarqubeRequest<unknown>(
    credentials,
    '/api/server/version',
    {},
    dependencies,
  ).catch((err: unknown) => {
    // Some reverse proxies or older builds disable this non-essential
    // endpoint. A valid authenticated API session is enough to bind.
    if (err instanceof SonarqubeApiError && (err.status === 403 || err.status === 404)) return null
    throw err
  })

  return { version: typeof version === 'string' ? version.trim() || null : null }
}
