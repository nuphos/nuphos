import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { encryptGrafanaSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { OutboundBlockedError, pinnedFetch, blockedUrlReason } from '@/lib/net/safe-outbound'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole, requireGrafanaInstance, requireGrafanaWriteRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables, GrafanaInstanceVariables } from '@/middleware/auth'

export const grafanaInstancesRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const PROXY_TIMEOUT_MS = 30_000

const bindSchema = z.object({
  name: z.string().min(1).max(64),
  grafanaUrl: z
    .string()
    .url()
    .superRefine((u, ctx) => {
      const reason = blockedUrlReason(u)

      if (reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: reason })
    }),
  saToken: z.string().min(1).transform(encryptGrafanaSecret),
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
    const { name, grafanaUrl, saToken: encryptedSaToken } = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const id = new ObjectId()
    const createdAt = new Date()

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { grafanaInstances: { id, name, grafanaUrl, encryptedSaToken, createdAt } },
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

// Only what a Grafana API call needs travels upstream; the caller's own
// headers (cookies, forwarding and metadata headers) stay here.
const FORWARD_REQUEST = new Set([
  'accept',
  'accept-language',
  'content-type',
  'x-disable-provenance',
  'x-grafana-org-id',
])
// The upstream body arrives decoded, so its Content-Encoding no longer applies;
// the response compression middleware re-encodes for the client.
const STRIP_RESPONSE = new Set(['set-cookie', 'content-encoding'])
const ERROR_MESSAGE_LIMIT = 300

/** An upstream failure, reduced to its status and Grafana's own short message. */
export async function grafanaErrorResponse(upstreamRes: Response): Promise<Response> {
  let message: string | undefined

  try {
    const parsed = (await upstreamRes.json()) as { message?: unknown }

    if (typeof parsed.message === 'string') message = parsed.message.slice(0, ERROR_MESSAGE_LIMIT)
  } catch {
    // Not JSON: the status alone is the answer.
  }

  return Response.json(
    { error: `HTTP ${String(upstreamRes.status)}`, ...(message ? { message } : {}) },
    { status: upstreamRes.status },
  )
}

export function toGrafanaProxyResponse(upstreamRes: Response): Response {
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
}

instanceScoped.all('/proxy/*', requireGrafanaWriteRole(), async (c) => {
  const proxyMarker = '/proxy/'
  const idx = c.req.path.indexOf(proxyMarker)

  if (idx < 0) {
    throw new AppError(400, 'invalid_proxy_path', 'Proxy path not found')
  }
  const upstreamPath = c.req.path.slice(idx + proxyMarker.length)
  const qs = new URL(c.req.url).search

  const base = c.get('grafanaUrl').replace(/\/$/, '')
  const upstreamUrl = `${base}/${upstreamPath}${qs}`

  const headers = new Headers()

  for (const [k, v] of c.req.raw.headers) {
    if (FORWARD_REQUEST.has(k.toLowerCase())) headers.set(k, v)
  }
  headers.set('Authorization', `Bearer ${c.get('grafanaSaToken')}`)

  const method = c.req.method
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await c.req.arrayBuffer())
  let upstreamRes: Response

  try {
    upstreamRes = await pinnedFetch(upstreamUrl, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    })
  } catch (e) {
    if (e instanceof OutboundBlockedError) {
      throw new AppError(e.status, 'grafana_host_refused', `Grafana host refused: ${e.message}`)
    }
    throw new AppError(
      502,
      'grafana_unreachable',
      `Failed to reach Grafana: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (upstreamRes.status >= 400) return await grafanaErrorResponse(upstreamRes)

  return toGrafanaProxyResponse(upstreamRes)
})

grafanaInstancesRoutes.route('/:instanceId', instanceScoped)
