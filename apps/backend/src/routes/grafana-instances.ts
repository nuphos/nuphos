import net from 'node:net'

import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole, requireGrafanaInstance } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables, GrafanaInstanceVariables } from '@/middleware/auth'

export const grafanaInstancesRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const PROXY_TIMEOUT_MS = 30_000

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')

  if (parts.length !== 4) return null
  let n = 0

  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)

    if (v < 0 || v > 255) return null
    n = (n << 8) | v
  }

  return n >>> 0
}

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip)

  if (n === null) return false
  const inRange = (cidr: number, bits: number) => n >>> (32 - bits) === cidr >>> (32 - bits)

  return (
    inRange(0x00000000, 8) || // 0.0.0.0/8
    inRange(0x0a000000, 8) || // 10.0.0.0/8
    inRange(0x64400000, 10) || // 100.64.0.0/10 CGNAT
    inRange(0x7f000000, 8) || // 127.0.0.0/8
    inRange(0xa9fe0000, 16) || // 169.254.0.0/16 link-local
    inRange(0xac100000, 12) || // 172.16.0.0/12
    inRange(0xc0a80000, 16) || // 192.168.0.0/16
    inRange(0xe0000000, 4) || // 224.0.0.0/4 multicast
    inRange(0xf0000000, 4) // 240.0.0.0/4 reserved
  )
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0]!

  if (lower === '::' || lower === '::1') return true
  if (/^fe[89ab]/.test(lower)) return true // fe80::/10 link-local
  if (/^f[cd]/.test(lower)) return true // fc00::/7 ULA
  if (lower.startsWith('ff')) return true // multicast
  // IPv4-mapped: ::ffff:a.b.c.d, may be normalized to hex form ::ffff:NNNN:NNNN
  if (lower.startsWith('::ffff:')) {
    const tail = lower.slice('::ffff:'.length)

    if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return isBlockedIPv4(tail)
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail)

    if (hex) {
      const a = parseInt(hex[1]!, 16)
      const b = parseInt(hex[2]!, 16)
      const dotted = `${String((a >> 8) & 0xff)}.${String(a & 0xff)}.${String((b >> 8) & 0xff)}.${String(b & 0xff)}`

      return isBlockedIPv4(dotted)
    }
  }

  return false
}

function blockedHostReason(grafanaUrl: string): string | null {
  let parsed: URL

  try {
    parsed = new URL(grafanaUrl)
  } catch {
    return 'invalid URL'
  }
  if (parsed.username || parsed.password) {
    return 'grafanaUrl must not contain embedded credentials'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'grafanaUrl must be http:// or https://'
  }
  // Bun's URL.hostname keeps brackets for IPv6 ([::1]); strip them and any %zone suffix.
  const raw = parsed.hostname.toLowerCase()
  const unbracketed = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw
  const host = unbracketed.split('%')[0]!

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return 'localhost / .local hosts are not allowed'
  }
  const kind = net.isIP(host)

  if (kind === 4 && isBlockedIPv4(host)) return 'private / loopback / reserved IPv4 not allowed'
  if (kind === 6 && isBlockedIPv6(host)) return 'private / loopback / reserved IPv6 not allowed'

  return null
}

const bindSchema = z.object({
  name: z.string().min(1).max(64),
  grafanaUrl: z
    .string()
    .url()
    .superRefine((u, ctx) => {
      const reason = blockedHostReason(u)

      if (reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: reason })
    }),
  saToken: z.string().min(1),
})

export function publicView(b: { id: ObjectId; name: string; grafanaUrl: string; createdAt: Date }) {
  return {
    id: b.id.toHexString(),
    name: b.name,
    grafanaUrl: b.grafanaUrl,
    createdAt: b.createdAt,
  }
}

grafanaInstancesRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { grafanaInstances: 1 } },
  )

  return c.json({
    instances: (doc?.grafanaInstances ?? []).map(publicView),
  })
})

grafanaInstancesRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const { name, grafanaUrl, saToken } = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const id = new ObjectId()
    const createdAt = new Date()

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { grafanaInstances: { id, name, grafanaUrl, saToken, createdAt } },
        $set: { updatedAt: createdAt },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          githubInstallations: [],
          cloudflareAccounts: [],
          linodeAccounts: [],
          tailscaleClients: [],
          zeaburProviders: [],
        },
      },
      { upsert: true },
    )

    return c.json(publicView({ id, name, grafanaUrl, createdAt }), 201)
  },
)

const instanceScoped = new Hono<{ Variables: GrafanaInstanceVariables }>()

instanceScoped.use('*', requireGrafanaInstance())

instanceScoped.get('/', (c) => {
  return c.json({
    id: c.get('grafanaInstanceId'),
    name: c.get('grafanaName'),
    grafanaUrl: c.get('grafanaUrl'),
  })
})

instanceScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const instanceId = new ObjectId(c.get('grafanaInstanceId'))

  await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { grafanaInstances: { id: instanceId } },
      $set: { updatedAt: new Date() },
    },
  )

  return c.body(null, 204)
})

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

const STRIP_REQUEST = new Set(['authorization', 'cookie'])
const STRIP_RESPONSE = new Set(['set-cookie'])

instanceScoped.all('/proxy/*', async (c) => {
  const proxyMarker = '/proxy/'
  const idx = c.req.path.indexOf(proxyMarker)

  if (idx < 0) {
    throw new AppError(400, 'invalid_proxy_path', 'Proxy path not found')
  }
  const upstreamPath = c.req.path.slice(idx + proxyMarker.length)
  const url = new URL(c.req.url)
  const qs = url.search

  const base = c.get('grafanaUrl').replace(/\/$/, '')
  const upstreamUrl = `${base}/${upstreamPath}${qs}`

  const headers = new Headers()

  for (const [k, v] of c.req.raw.headers) {
    const lower = k.toLowerCase()

    if (HOP_BY_HOP.has(lower)) continue
    if (STRIP_REQUEST.has(lower)) continue
    headers.set(k, v)
  }
  headers.set('Authorization', `Bearer ${c.get('grafanaSaToken')}`)

  const method = c.req.method
  const hasBody = method !== 'GET' && method !== 'HEAD'

  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    redirect: 'manual',
  }

  if (hasBody) {
    init.body = c.req.raw.body
    init.duplex = 'half'
  }

  let upstreamRes: Response
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, PROXY_TIMEOUT_MS)

  try {
    upstreamRes = await fetch(upstreamUrl, { ...init, signal: controller.signal })
  } catch (e) {
    throw new AppError(
      502,
      'grafana_unreachable',
      `Failed to reach Grafana: ${e instanceof Error ? e.message : String(e)}`,
    )
  } finally {
    clearTimeout(timeout)
  }

  const respHeaders = new Headers()

  for (const [k, v] of upstreamRes.headers) {
    const lower = k.toLowerCase()

    if (HOP_BY_HOP.has(lower)) continue
    if (STRIP_RESPONSE.has(lower)) continue
    respHeaders.set(k, v)
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: respHeaders,
  })
})

grafanaInstancesRoutes.route('/:instanceId', instanceScoped)
