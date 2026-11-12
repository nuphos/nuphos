import { config } from '@/config'
import { AppError } from '@/lib/errors'

const API = 'https://backend.composio.dev/api/v3.1'

export async function composioRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'x-api-key': config.byos.composio.apiKey ?? '', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }

  if (!res.ok) {
    throw new AppError(
      res.status === 429 ? 429 : 502,
      res.status === 429 ? 'composio_rate_limited' : 'composio_request_failed',
      `Composio request failed (HTTP ${String(res.status)})`,
      { upstreamStatus: res.status },
    )
  }

  return json
}

type AuthConfig = { id: string; created_at?: string }

const oldest = (items: AuthConfig[]) =>
  items.toSorted(
    (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id),
  )[0]?.id

async function resolveAuthConfigId(toolkitSlug: string): Promise<string> {
  const list = () =>
    composioRequest<{ items: AuthConfig[] }>(
      'GET',
      `/auth_configs?toolkit_slug=${encodeURIComponent(toolkitSlug)}&is_composio_managed=true&limit=200`,
    ).then((res) => oldest(res.items))
  const existing = await list()

  if (existing) return existing
  await composioRequest('POST', '/auth_configs', {
    toolkit: { slug: toolkitSlug },
    auth_config: { type: 'use_composio_managed_auth' },
  })
  // Another process may have created one at the same moment: every process settles on the oldest.
  const created = await list()

  if (!created) {
    throw new AppError(502, 'composio_request_failed', 'Composio returned no auth config')
  }

  return created
}

const authConfigIds = new Map<string, Promise<string>>()

/**
 * The project's Composio-managed auth config for a toolkit: the oldest one,
 * created when there is none. Every connection is made and checked against it.
 */
export function composioAuthConfigId(toolkitSlug: string): Promise<string> {
  let id = authConfigIds.get(toolkitSlug)

  if (!id) {
    id = resolveAuthConfigId(toolkitSlug)
    id.catch(() => authConfigIds.delete(toolkitSlug))
    authConfigIds.set(toolkitSlug, id)
  }

  return id
}
