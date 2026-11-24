import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { encryptCustomMcpSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { teamMcpServers } from '@/lib/mcp/team-servers'
import { blockedUrlReason, privateHostReason } from '@/lib/net/safe-outbound'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { TeamMcpServer } from '@/lib/mcp/team-servers'
import type { TeamAuthVariables } from '@/middleware/auth'

export const teamMcpServersRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const MAX_MCP_SERVERS = 20
// Set by the HTTP client or the MCP transport, not by a stored credential.
const RESERVED_HEADER =
  /^(host|content-length|content-type|transfer-encoding|connection|user-agent|accept-encoding)$/i
// These names already identify the ACP servers Nuphos sends itself.
const RESERVED_SERVER_NAME = new Set(['nuphos-credentials', 'nuphos-tools'])

// Headers are secrets: a public URL is https, with no query or fragment.
// http is only for a private host when the deployment allows private hosts.
function mcpServerUrlReason(raw: string): string | null {
  const blocked = blockedUrlReason(raw)

  if (blocked) return blocked
  const url = new URL(raw)

  if (url.search || url.hash) return 'URL must not contain a query or fragment'
  if (url.protocol === 'http:' && !privateHostReason(url)) return 'URL must be https://'

  return null
}

const url = z
  .string()
  .max(2048)
  .superRefine((value, ctx) => {
    const reason = mcpServerUrlReason(value)

    if (reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: reason })
  })
const serverName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((name) => !RESERVED_SERVER_NAME.has(name.toLowerCase()), 'This name is reserved')
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
  new Set(headers.map((header) => header.name.toLowerCase())).size === headers.length
const headerList = z
  .array(z.object({ name: headerName, value: headerValue }))
  .max(10)
  .refine(uniqueNames, 'Duplicate header')

const createSchema = z.object({
  name: serverName,
  url,
  headers: headerList.default([]),
})

const updateSchema = z.object({
  name: serverName.optional(),
  url: url.optional(),
  /** The full list; a header without a value keeps its stored one. */
  headers: z
    .array(z.object({ name: headerName, value: headerValue.optional() }))
    .max(10)
    .refine(uniqueNames, 'Duplicate header')
    .optional(),
})

function view(server: TeamMcpServer) {
  return {
    id: server._id.toHexString(),
    name: server.name,
    url: server.url,
    headers: server.headers.map((header) => header.name),
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  }
}

function sealHeaders(
  stored: { name: string; value: EncryptedSecret }[],
  headers: { name: string; value?: string }[],
): { name: string; value: EncryptedSecret }[] {
  const previous = new Map(stored.map((header) => [header.name.toLowerCase(), header.value]))

  return headers.map((header) => {
    const value =
      header.value === undefined
        ? previous.get(header.name.toLowerCase())
        : encryptCustomMcpSecret(header.value)

    if (!value)
      throw new AppError(400, 'header_value_required', `Enter a value for ${header.name}.`)

    return { name: header.name, value }
  })
}

async function findServer(teamId: string, id: string): Promise<TeamMcpServer> {
  const server = await teamMcpServers().findOne({
    _id: parseObjectId(id, 'mcpServerId'),
    teamId,
  })

  if (!server) throw new AppError(404, 'mcp_server_not_found', 'MCP server not found.')

  return server
}

// URLs and header names describe the team's systems: administrators only.
teamMcpServersRoutes.use('*', requireTeamRole('ADMINISTRATOR'))

teamMcpServersRoutes.get('/', async (c) => {
  const servers = await teamMcpServers()
    .find({ teamId: c.get('teamId') })
    .sort({ createdAt: 1 })
    .toArray()

  return c.json({ mcpServers: servers.map(view) })
})

teamMcpServersRoutes.post('/', zv('json', createSchema), async (c) => {
  const input = c.req.valid('json')
  const teamId = c.get('teamId')

  if ((await teamMcpServers().countDocuments({ teamId })) >= MAX_MCP_SERVERS) {
    throw new AppError(
      409,
      'mcp_server_limit',
      `A team can have up to ${String(MAX_MCP_SERVERS)} MCP servers.`,
    )
  }
  const now = new Date()
  const server: TeamMcpServer = {
    _id: new ObjectId(),
    teamId,
    name: input.name,
    url: input.url,
    headers: sealHeaders([], input.headers),
    createdBy: c.get('userId'),
    createdAt: now,
    updatedAt: now,
  }

  await teamMcpServers().insertOne(server)

  return c.json({ mcpServer: view(server) }, 201)
})

teamMcpServersRoutes.patch('/:id', zv('json', updateSchema), async (c) => {
  const { headers, ...rest } = c.req.valid('json')
  const server = await findServer(c.get('teamId'), c.req.param('id'))
  const nextHeaders = headers ? sealHeaders(server.headers, headers) : undefined
  const updated = await teamMcpServers().findOneAndUpdate(
    { _id: server._id, teamId: server.teamId },
    { $set: { ...rest, ...(nextHeaders ? { headers: nextHeaders } : {}), updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  return c.json({ mcpServer: view(updated ?? server) })
})

teamMcpServersRoutes.delete('/:id', async (c) => {
  const server = await findServer(c.get('teamId'), c.req.param('id'))

  await teamMcpServers().deleteOne({ _id: server._id, teamId: server.teamId })

  return c.json({ ok: true })
})
