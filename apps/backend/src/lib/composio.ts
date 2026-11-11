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
