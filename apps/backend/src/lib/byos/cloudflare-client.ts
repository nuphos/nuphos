export type CloudflareAccountHandle = {
  accountId: string
  apiKey: string
}

type CloudflareError = {
  code?: number
  message?: string
}

type CloudflareResponse<T> = {
  success: boolean
  errors?: CloudflareError[]
  result?: T
  result_info?: {
    page?: number
    per_page?: number
    count?: number
    total_count?: number
    total_pages?: number
  }
}

type CloudflareAccountResult = {
  id: string
  name?: string
}

class CloudflareApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: CloudflareError[],
  ) {
    super(message)
    this.name = 'CloudflareApiError'
  }
}

function errorMessage(
  status: number,
  path: string,
  init: RequestInit,
  errors: CloudflareError[] | undefined,
): string {
  const first = errors?.find((e) => e.message)
  const message = first?.message ?? `Cloudflare API returned HTTP ${String(status)}`

  if (status === 401 || status === 403) {
    const method = init.method?.toUpperCase() ?? 'GET'
    const pathWithoutQuery = path.split('?')[0] ?? path

    if (/^\/accounts\/[^/]+$/.test(pathWithoutQuery)) {
      return `${message}. Missing Cloudflare API token permission: Account > Account Settings > Read for this account. Nuphos needs this during bind to verify the account ID.`
    }
    if (pathWithoutQuery === '/zones') {
      return `${message}. Missing Cloudflare API token permission: Zone > Zone > Read for the zones in this account. Nuphos needs this to list domains.`
    }
    if (pathWithoutQuery.includes('/dns_records')) {
      const permission = method === 'GET' ? 'Zone > DNS > Read' : 'Zone > DNS > Edit'

      return `${message}. Missing Cloudflare API token permission: ${permission} for this zone. DNS View is not enough for DNS records.`
    }
    const readOrEdit = method === 'GET' ? 'Read' : 'Edit'

    if (pathWithoutQuery.includes('/workers/')) {
      return `${message}. Missing Cloudflare API token permission: Account > Workers Scripts > ${readOrEdit} for this account.`
    }
    if (pathWithoutQuery.includes('/r2/')) {
      return `${message}. Missing Cloudflare API token permission: Account > Workers R2 Storage > ${readOrEdit} for this account.`
    }
    if (pathWithoutQuery.includes('/pages/')) {
      return `${message}. Missing Cloudflare API token permission: Account > Pages > ${readOrEdit} for this account.`
    }
    if (pathWithoutQuery.includes('/d1/')) {
      return `${message}. Missing Cloudflare API token permission: Account > D1 > ${readOrEdit} for this account.`
    }
    if (pathWithoutQuery.includes('/storage/kv/')) {
      return `${message}. Missing Cloudflare API token permission: Account > Workers KV Storage > ${readOrEdit} for this account.`
    }
  }

  return message
}

async function cloudflareRequestPayload<T>(
  handle: CloudflareAccountHandle,
  path: string,
  init: RequestInit = {},
): Promise<CloudflareResponse<T>> {
  const headers = new Headers(init.headers)

  headers.set('Accept', 'application/json')
  headers.set('Authorization', `Bearer ${handle.apiKey}`)

  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers,
  })
  let payload: CloudflareResponse<T> | null = null

  try {
    payload = (await res.json()) as CloudflareResponse<T>
  } catch {
    // keep HTTP status fallback below
  }
  if (!res.ok || payload?.success === false) {
    throw new CloudflareApiError(
      res.status,
      errorMessage(res.status, path, init, payload?.errors),
      payload?.errors,
    )
  }
  if (payload?.result === undefined) {
    throw new Error('Cloudflare API returned an empty response')
  }

  return payload
}

export async function cloudflareRequest<T>(
  handle: CloudflareAccountHandle,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const payload = await cloudflareRequestPayload<T>(handle, path, init)

  return payload.result as T
}

/**
 * Raw Cloudflare request that returns the Fetch Response without unwrapping the
 * standard `{ success, result }` envelope. Needed for endpoints that return raw
 * bodies (e.g. KV `GET …/values/{key}` returns the stored value verbatim).
 */
export async function cloudflareRawRequest(
  handle: CloudflareAccountHandle,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)

  headers.set('Authorization', `Bearer ${handle.apiKey}`)
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers,
  })

  if (!res.ok) {
    let errors: CloudflareError[] | undefined

    try {
      const payload = (await res.clone().json()) as CloudflareResponse<unknown>

      errors = payload?.errors
    } catch {
      // non-JSON error body — fall back to HTTP status message
    }
    throw new CloudflareApiError(res.status, errorMessage(res.status, path, init, errors), errors)
  }

  return res
}

export async function cloudflarePaginatedRequest<T>(
  handle: CloudflareAccountHandle,
  path: string,
  params: URLSearchParams,
): Promise<T[]> {
  const items: T[] = []
  const pageParams = new URLSearchParams(params)

  pageParams.set('per_page', pageParams.get('per_page') ?? '100')

  let page = Number(pageParams.get('page') ?? '1')

  for (;;) {
    pageParams.set('page', String(page))
    const payload = await cloudflareRequestPayload<T[]>(handle, `${path}?${String(pageParams)}`)

    items.push(...(payload.result ?? []))

    const totalPages = payload.result_info?.total_pages

    if (totalPages && page >= totalPages) break
    if (!totalPages && (payload.result ?? []).length < Number(pageParams.get('per_page'))) break
    page += 1
  }

  return items
}

export async function verifyCloudflareAccount(
  handle: CloudflareAccountHandle,
): Promise<{ accountId: string; accountName: string | null }> {
  const account = await cloudflareRequest<CloudflareAccountResult>(
    handle,
    `/accounts/${encodeURIComponent(handle.accountId)}`,
  )

  return {
    accountId: account.id,
    accountName: account.name ?? null,
  }
}
