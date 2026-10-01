import { AppError } from '@/lib/errors'

export type ZeaburHandle = { token: string; zeaburId: string; kind: 'user' | 'team' }

export type ZeaburIdentity = {
  zeaburId: string
  kind: 'user' | 'team'
  name: string
}

export type ZeaburProject = {
  id: string
  name: string
  status: string | null
  region: string | null
  createdAt: string | null
}

export type ZeaburServer = {
  id: string
  name: string
  status: string | null
  region: string | null
  createdAt: string | null
  ip: string | null
  sshPort: number | null
  sshUsername: string | null
  isOnline: boolean | null
  vmStatus: string | null
  sshAvailable: boolean | null
  latency: number | null
  totalCPU: number | null
  usedCPU: number | null
  totalMemory: number | null
  usedMemory: number | null
  totalDisk: number | null
  usedDisk: number | null
  warnings: string[]
}

type GraphqlResponse<T> = {
  errors?: { message?: string }[]
  data?: T
}

async function zeaburGraphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch('https://api.zeabur.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err: unknown) => {
    throw new AppError(
      502,
      'zeabur_api_unavailable',
      `Could not reach Zeabur API: ${(err as Error).message}`,
    )
  })

  if (res.status === 401 || res.status === 403) {
    throw new AppError(
      400,
      'invalid_zeabur_token',
      'The Zeabur API token is invalid or has been revoked.',
    )
  }
  if (!res.ok) {
    throw new AppError(
      502,
      'zeabur_api_unavailable',
      `Could not reach Zeabur API: HTTP ${String(res.status)}`,
    )
  }
  const body = (await res.json().catch(() => null)) as GraphqlResponse<T> | null

  if (!body) {
    throw new AppError(502, 'zeabur_api_error', 'Zeabur API returned an invalid response.')
  }
  if (body.errors?.length) {
    throw new AppError(
      502,
      'zeabur_api_error',
      body.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join('; ') || 'Zeabur API returned an error.',
    )
  }
  if (!body.data) {
    throw new AppError(
      400,
      'invalid_zeabur_token',
      'The Zeabur API token is invalid or has insufficient access.',
    )
  }

  return body.data
}

function pickString(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const item = value[key]

    if (typeof item === 'string' && item.trim()) return item
  }

  return null
}

function pickObject(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const item = value[key]

  return item && typeof item === 'object' ? (item as Record<string, unknown>) : null
}

function pickNumber(value: Record<string, unknown> | null, key: string): number | null {
  const item = value?.[key]

  return typeof item === 'number' && Number.isFinite(item) ? item : null
}

function pickBoolean(value: Record<string, unknown> | null, key: string): boolean | null {
  const item = value?.[key]

  return typeof item === 'boolean' ? item : null
}

function pickStringArray(value: Record<string, unknown> | null, key: string): string[] {
  const item = value?.[key]

  return Array.isArray(item)
    ? item.filter((child): child is string => typeof child === 'string')
    : []
}

function connectionNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value))
    return value.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === 'object',
    )
  if (!value || typeof value !== 'object') return []
  const edges = (value as Record<string, unknown>).edges

  if (!Array.isArray(edges)) return []

  return edges.flatMap((edge) => {
    if (!edge || typeof edge !== 'object') return []
    const node = (edge as Record<string, unknown>).node

    return node && typeof node === 'object' ? [node as Record<string, unknown>] : []
  })
}

export async function discoverZeaburIdentities(token: string): Promise<ZeaburIdentity[]> {
  const data = await zeaburGraphql<{
    me?: Record<string, unknown>
    teams?: Record<string, unknown>[]
  }>(token, 'query { me { _id username name email } teams { _id name } }')
  const identities = new Map<string, ZeaburIdentity>()
  const me = data.me

  if (me && typeof me === 'object') {
    const zeaburId = pickString(me, ['_id', 'id'])

    if (zeaburId) {
      identities.set(zeaburId, {
        zeaburId,
        kind: 'user',
        name: pickString(me, ['name', 'username', 'email']) ?? zeaburId,
      })
    }
  }
  for (const team of data.teams ?? []) {
    const zeaburId = pickString(team, ['_id', 'id'])

    if (!zeaburId) continue
    identities.set(zeaburId, {
      zeaburId,
      kind: 'team',
      name: pickString(team, ['name']) ?? zeaburId,
    })
  }
  if (identities.size === 0) {
    throw new AppError(
      400,
      'invalid_zeabur_token',
      'The Zeabur API token did not return any accessible Zeabur identities.',
    )
  }

  return [...identities.values()]
}

export async function listZeaburProjects(handle: ZeaburHandle): Promise<ZeaburProject[]> {
  const data = await zeaburGraphql<{ projects?: unknown }>(
    handle.token,
    'query Projects($ownerID: ObjectID) { projects(ownerID: $ownerID) { edges { node { _id name createdAt region { code name } } } } }',
    handle.kind === 'team' ? { ownerID: handle.zeaburId } : {},
  )

  return connectionNodes(data.projects).flatMap((node) => {
    const id = pickString(node, ['_id', 'id'])
    const name = pickString(node, ['name'])

    if (!id || !name) return []
    const region = pickObject(node, 'region')

    return [
      {
        id,
        name,
        status: null,
        region: region ? pickString(region, ['code', 'name']) : null,
        createdAt: pickString(node, ['createdAt', 'created']),
      },
    ]
  })
}

export async function listZeaburServers(handle: ZeaburHandle): Promise<ZeaburServer[]> {
  const data = await zeaburGraphql<{ servers?: unknown }>(
    handle.token,
    'query Servers($ownerID: ObjectID) { servers(ownerID: $ownerID) { _id name ip sshPort sshUsername createdAt city country status { isOnline vmStatus sshAvailable latency totalCPU usedCPU totalMemory usedMemory totalDisk usedDisk warnings } } }',
    handle.kind === 'team' ? { ownerID: handle.zeaburId } : {},
  )

  return connectionNodes(data.servers).flatMap((node) => {
    const id = pickString(node, ['_id', 'id'])
    const name = pickString(node, ['name', 'hostname'])

    if (!id || !name) return []
    const status = pickObject(node, 'status')
    const vmStatus = status ? pickString(status, ['vmStatus']) : null
    const isOnline = status?.isOnline
    const location = [pickString(node, ['city']), pickString(node, ['country'])]
      .filter(Boolean)
      .join(', ')

    return [
      {
        id,
        name,
        status:
          vmStatus ?? (typeof isOnline === 'boolean' ? (isOnline ? 'online' : 'offline') : null),
        region: location || null,
        createdAt: pickString(node, ['createdAt', 'created']),
        ip: pickString(node, ['ip']),
        sshPort: pickNumber(node, 'sshPort'),
        sshUsername: pickString(node, ['sshUsername']),
        isOnline: pickBoolean(status, 'isOnline'),
        vmStatus,
        sshAvailable: pickBoolean(status, 'sshAvailable'),
        latency: pickNumber(status, 'latency'),
        totalCPU: pickNumber(status, 'totalCPU'),
        usedCPU: pickNumber(status, 'usedCPU'),
        totalMemory: pickNumber(status, 'totalMemory'),
        usedMemory: pickNumber(status, 'usedMemory'),
        totalDisk: pickNumber(status, 'totalDisk'),
        usedDisk: pickNumber(status, 'usedDisk'),
        warnings: pickStringArray(status, 'warnings'),
      },
    ]
  })
}
