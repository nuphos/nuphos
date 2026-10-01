const HETZNER_API = 'https://api.hetzner.cloud/v1'

export type HetznerHandle = { token: string }

export type HetznerServer = {
  id: number
  name: string
  status: string
  serverType: string
  location: string
  ipv4: string | null
  ipv6: string | null
  created: string | null
}

export class HetznerApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HetznerApiError'
  }
}

async function hetznerGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${HETZNER_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    let reason = `HTTP ${String(res.status)}`

    try {
      const body = (await res.json()) as { error?: { message?: string } }

      if (body.error?.message) reason = body.error.message
    } catch {
      // ignore
    }
    throw new HetznerApiError(res.status, reason)
  }

  return res.json() as Promise<T>
}

type HetznerPage = Record<string, unknown> & {
  meta?: { pagination?: { next_page: number | null } }
}

// Hetzner Cloud paginates via meta.pagination.next_page (null when exhausted)
// and caps per_page at 50, unlike Linode's page_size=500.
// Safety cap: 200 pages × 50 = 10k items. next_page should always advance, but
// a misbehaving API returning a non-null, non-advancing cursor must not loop
// forever, so we also bail if the cursor fails to move past the current page.
const HETZNER_MAX_PAGES = 200

async function hetznerGetAll<T>(token: string, path: string, key: string): Promise<T[]> {
  const results: T[] = []
  let page = 1

  for (let fetched = 0; fetched < HETZNER_MAX_PAGES; fetched++) {
    const sep = path.includes('?') ? '&' : '?'
    const data: HetznerPage = await hetznerGet<HetznerPage>(
      token,
      `${path}${sep}per_page=50&page=${String(page)}`,
    )
    const items = (data[key] as T[] | undefined) ?? []

    results.push(...items)
    const nextPage = data.meta?.pagination?.next_page ?? null

    if (nextPage === null || nextPage <= page) break
    page = nextPage
  }

  return results
}

type RawHetznerServer = {
  id: number
  name: string
  status: string
  server_type?: { name?: string } | null
  location?: { name?: string } | null
  datacenter?: { location?: { name?: string } | null } | null
  public_net?: {
    ipv4?: { ip?: string | null } | null
    ipv6?: { ip?: string | null } | null
  } | null
  created?: string | null
}

export async function listHetznerServers(handle: HetznerHandle): Promise<HetznerServer[]> {
  const servers = await hetznerGetAll<RawHetznerServer>(handle.token, '/servers', 'servers')

  return servers.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    serverType: s.server_type?.name ?? '',
    location: s.location?.name ?? s.datacenter?.location?.name ?? '',
    ipv4: s.public_net?.ipv4?.ip ?? null,
    ipv6: s.public_net?.ipv6?.ip ?? null,
    created: s.created ?? null,
  }))
}

// Hetzner Cloud has no account/profile identity endpoint and its tokens are
// project-scoped with no username, so we validate by hitting a cheap
// authenticated endpoint: a 401 means the token is invalid or revoked.
export async function verifyHetznerToken(handle: HetznerHandle): Promise<void> {
  await hetznerGet(handle.token, '/servers?per_page=1')
}
