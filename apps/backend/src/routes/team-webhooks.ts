import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { encryptWebhookSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { blockedUrlReason } from '@/lib/net/safe-outbound'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { sendWebhook } from '@/lib/webhooks/deliver'
import { WEBHOOK_EVENTS, newEventId, teamWebhooks, webhookDeliveries } from '@/lib/webhooks/store'
import { requireTeamRole } from '@/middleware/auth'

import type { TeamWebhook } from '@/lib/webhooks/store'
import type { TeamAuthVariables } from '@/middleware/auth'

export const teamWebhooksRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const MAX_WEBHOOKS = 20
// Set by Nuphos on every request, or by the HTTP client.
const RESERVED_HEADER =
  /^(host|content-length|content-type|transfer-encoding|connection|user-agent|accept-encoding|webhook-.*)$/i

const url = z
  .string()
  .max(2048)
  .superRefine((u, ctx) => {
    const reason = u.startsWith('https://') ? blockedUrlReason(u) : 'URL must be https://'

    if (reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: reason })
  })
const headerName = z
  .string()
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/, 'Invalid header name')
  .refine((name) => !RESERVED_HEADER.test(name), 'This header is set by Nuphos')
const headerValue = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\r\n\0]*$/, 'Invalid header value')
const uniqueNames = (headers: { name: string }[]) =>
  new Set(headers.map((h) => h.name.toLowerCase())).size === headers.length
const events = z
  .array(z.enum(WEBHOOK_EVENTS))
  .min(1)
  .transform((list) => [...new Set(list)])

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
  url,
  events,
  headers: z
    .array(z.object({ name: headerName, value: headerValue }))
    .max(10)
    .refine(uniqueNames, 'Duplicate header')
    .default([]),
  enabled: z.boolean().default(true),
})

const updateSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  url: url.optional(),
  events: events.optional(),
  /** The full list; a header without a value keeps its stored one. */
  headers: z
    .array(z.object({ name: headerName, value: headerValue.optional() }))
    .max(10)
    .refine(uniqueNames, 'Duplicate header')
    .optional(),
  enabled: z.boolean().optional(),
})

function view(hook: TeamWebhook) {
  return {
    id: hook._id.toHexString(),
    name: hook.name,
    url: hook.url,
    events: hook.events,
    headers: hook.headers.map((h) => h.name),
    enabled: hook.enabled,
    disabledReason: hook.disabledReason ?? null,
    lastDelivery: hook.lastDelivery ?? null,
    createdAt: hook.createdAt,
    updatedAt: hook.updatedAt,
  }
}

async function findHook(teamId: string, id: string): Promise<TeamWebhook> {
  const hook = await teamWebhooks().findOne({ _id: parseObjectId(id, 'webhookId'), teamId })

  if (!hook) throw new AppError(404, 'webhook_not_found', 'Webhook not found.')

  return hook
}

// URLs and header names describe the team's systems: administrators only.
teamWebhooksRoutes.use('*', requireTeamRole('ADMINISTRATOR'))

teamWebhooksRoutes.get('/', async (c) => {
  const hooks = await teamWebhooks()
    .find({ teamId: c.get('teamId') })
    .sort({ createdAt: 1 })
    .toArray()

  return c.json({ webhooks: hooks.map(view), events: WEBHOOK_EVENTS })
})

teamWebhooksRoutes.post('/', zv('json', createSchema), async (c) => {
  const input = c.req.valid('json')
  const teamId = c.get('teamId')

  if ((await teamWebhooks().countDocuments({ teamId })) >= MAX_WEBHOOKS)
    throw new AppError(
      409,
      'webhook_limit',
      `A team can have up to ${String(MAX_WEBHOOKS)} webhooks.`,
    )
  const now = new Date()
  const hook: TeamWebhook = {
    _id: new ObjectId(),
    teamId,
    ...input,
    headers: input.headers.map((h) => ({ name: h.name, value: encryptWebhookSecret(h.value) })),
    createdBy: c.get('userId'),
    createdAt: now,
    updatedAt: now,
  }

  await teamWebhooks().insertOne(hook)

  return c.json({ webhook: view(hook) }, 201)
})

teamWebhooksRoutes.patch('/:id', zv('json', updateSchema), async (c) => {
  const { headers, ...rest } = c.req.valid('json')
  const hook = await findHook(c.get('teamId'), c.req.param('id'))
  const stored = new Map(hook.headers.map((h) => [h.name.toLowerCase(), h.value]))
  const nextHeaders = headers?.map((h) => {
    const value =
      h.value === undefined ? stored.get(h.name.toLowerCase()) : encryptWebhookSecret(h.value)

    if (!value) throw new AppError(400, 'header_value_required', `Enter a value for ${h.name}.`)

    return { name: h.name, value }
  })
  const updated = await teamWebhooks().findOneAndUpdate(
    { _id: hook._id },
    {
      $set: {
        ...rest,
        ...(nextHeaders ? { headers: nextHeaders } : {}),
        updatedAt: new Date(),
      },
      // Switching it back on clears why delivery switched it off.
      ...(rest.enabled ? { $unset: { disabledReason: '' as const } } : {}),
    },
    { returnDocument: 'after' },
  )

  return c.json({ webhook: view(updated ?? hook) })
})

teamWebhooksRoutes.delete('/:id', async (c) => {
  const hook = await findHook(c.get('teamId'), c.req.param('id'))

  await teamWebhooks().deleteOne({ _id: hook._id })
  await webhookDeliveries().deleteMany({ webhookId: hook._id })

  return c.json({ ok: true })
})

teamWebhooksRoutes.post('/:id/test', async (c) => {
  const hook = await findHook(c.get('teamId'), c.req.param('id'))
  const id = newEventId()
  const body = JSON.stringify({
    id,
    type: 'webhook.test',
    created_at: new Date().toISOString(),
    team_id: hook.teamId,
    data: {},
  })
  const { ok, status, error } = await sendWebhook(hook, id, body)

  return c.json({ ok, status, error: error ?? null })
})
