import type { PosthogRegion } from '@/models'

const REQUEST_TIMEOUT_MS = 30_000

export const POSTHOG_REGION_HOSTS: Record<PosthogRegion, string> = {
  us: 'https://us.posthog.com',
  eu: 'https://eu.posthog.com',
}

export class PosthogApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'PosthogApiError'
  }
}

export type PosthogFetch = (url: string, init: RequestInit) => Promise<Response>

export type PosthogCredentials = {
  apiBaseUrl: string
  accessToken: string
}

function errorDetail(payload: unknown): { message: string | null; code: string | null } {
  if (payload && typeof payload === 'object') {
    const body = payload as {
      detail?: unknown
      code?: unknown
      error?: unknown
      error_description?: unknown
    }
    const message = [body.detail, body.error_description, body.error].find(
      (value): value is string => typeof value === 'string',
    )
    const code = [body.code, body.error].find((value): value is string => typeof value === 'string')

    return { message: message ?? null, code: code ?? null }
  }

  return {
    message: typeof payload === 'string' && payload ? payload.slice(0, 300) : null,
    code: null,
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()

  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export async function posthogFetchJson<T>(
  url: string,
  init: RequestInit,
  fetchImpl: PosthogFetch = fetch,
): Promise<T> {
  let res: Response

  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)

    throw new PosthogApiError(0, `Could not reach PostHog: ${detail}`)
  }

  const payload = await parseBody(res)

  if (!res.ok) {
    const { message, code } = errorDetail(payload)

    throw new PosthogApiError(
      res.status,
      message ?? `PostHog returned HTTP ${String(res.status)}`,
      code ?? undefined,
    )
  }

  return payload as T
}

export async function posthogGet<T>(
  credentials: PosthogCredentials,
  path: string,
  fetchImpl?: PosthogFetch,
): Promise<T> {
  return await posthogFetchJson<T>(
    `${credentials.apiBaseUrl}${path}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${credentials.accessToken}` },
    },
    fetchImpl,
  )
}
