const LINODE_API = 'https://api.linode.com/v4'

export type LinodeHandle = { token: string }

export type LinodeInstance = {
  id: number
  label: string
  region: string
  type: string
  status: string
  ipv4: string[]
  ipv6: string | null
  created: string | null
}

export type LkeCluster = {
  id: number
  label: string
  region: string
  k8s_version: string
  status: string
  created: string | null
}

export class LinodeApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'LinodeApiError'
  }
}

async function linodeGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${LINODE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    let reason = `HTTP ${String(res.status)}`

    try {
      const body = (await res.json()) as { errors?: { reason?: string }[] }

      if (body.errors?.[0]?.reason) reason = body.errors[0].reason
    } catch {
      // ignore
    }
    throw new LinodeApiError(res.status, reason)
  }

  return res.json() as Promise<T>
}

async function linodeGetAll<T>(token: string, path: string): Promise<T[]> {
  const results: T[] = []
  let page = 1

  while (true) {
    const sep = path.includes('?') ? '&' : '?'
    const data = await linodeGet<{ data: T[]; pages: number; page: number }>(
      token,
      `${path}${sep}page_size=500&page=${String(page)}`,
    )

    results.push(...(data.data ?? []))
    if (page >= data.pages) break
    page++
  }

  return results
}

export async function listLinodeInstances(handle: LinodeHandle): Promise<LinodeInstance[]> {
  return linodeGetAll<LinodeInstance>(handle.token, '/linode/instances')
}

export async function listLkeClusters(handle: LinodeHandle): Promise<LkeCluster[]> {
  return linodeGetAll<LkeCluster>(handle.token, '/lke/clusters')
}

export async function getLkeKubeconfig(handle: LinodeHandle, clusterId: number): Promise<string> {
  const data = await linodeGet<{ kubeconfig: string }>(
    handle.token,
    `/lke/clusters/${String(clusterId)}/kubeconfig`,
  )

  return Buffer.from(data.kubeconfig, 'base64').toString('utf-8')
}

export async function verifyLinodeToken(handle: LinodeHandle): Promise<{ username: string }> {
  const data = await linodeGet<{ username: string }>(handle.token, '/profile')

  return { username: data.username }
}
