import { ObjectId } from 'mongodb'

import { credentialSourceOf } from '@/lib/agent/db/credential-source'
import { decryptCustomMcpSecret } from '@/lib/byos/secrets'
import { OutboundBlockedError, resolvePublicTarget } from '@/lib/net/safe-outbound'
import { logError, logEvent } from '@/lib/observability'

import {
  ANTIGRAVITY_DECLARATION_BUDGET,
  ANTIGRAVITY_NUPHOS_RESERVE,
  customDeclarationFits,
  declarationBytes,
} from './declaration-budget'
import { listRemoteMcpDeclaration } from './remote-declaration'
import { teamMcpServers } from './team-servers'

import type { McpToolDeclaration } from './declaration-budget'
import type { TeamMcpServer } from './team-servers'
import type { AcpHttpMcpServer } from '@/lib/claude-code-preview/openab-acp-session'

export type ConversationMcpServers = {
  servers: AcpHttpMcpServer[]
  notices: string[]
}

export type PreviewSessionAccess = {
  mcpServers: AcpHttpMcpServer[]
  notices: string[]
  runtimeEnv?: Record<string, string>
}

type Declaration = { tools: McpToolDeclaration[]; instructions: string }

export type AssembleMcpServersArgs = {
  selectedIds: readonly string[]
  servers: readonly TeamMcpServer[]
  /** Antigravity is the runtime that drops tools past the shared budget with no error. */
  agentRuntime?: string
  /** Classifies the host the way a dial would. Defaults to `resolvePublicTarget`. */
  checkEgress?: (url: string) => Promise<void>
  /** Reads the server's tool declaration. Defaults to a streamable-HTTP `tools/list`. */
  listDeclaration?: (input: {
    url: string
    headers: { name: string; value: string }[]
  }) => Promise<Declaration>
  /** Bytes the nuphos servers already occupy. Measured when omitted on Antigravity. */
  reservedBytes?: number
  log?: (fields: Record<string, unknown>) => void
}

const HEX_ID = /^[a-f0-9]{24}$/i

const LOAD_NOTICE =
  'Custom MCP servers were not added: their selection could not be read for this turn.'

/**
 * What may be logged or stored. Header values are not part of it: they exist only on the
 * in-memory ACP config the runtime is handed.
 */
export function customMcpLogFields(
  servers: readonly AcpHttpMcpServer[],
  notices: readonly string[],
): {
  servers: { name: string; url: string; headers: string[] }[]
  notices: string[]
} {
  return {
    servers: servers.map((server) => ({
      name: server.name,
      url: server.url,
      headers: server.headers.map((header) => header.name),
    })),
    notices: [...notices],
  }
}

function databaseDisconnected(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Database not connected')
}

function objectIds(ids: readonly string[]): ObjectId[] {
  return ids.filter((id) => HEX_ID.test(id)).map((id) => new ObjectId(id))
}

async function defaultEgress(url: string): Promise<void> {
  await resolvePublicTarget(url)
}

function egressNotice(name: string, err: unknown): string {
  const reason =
    err instanceof OutboundBlockedError ? err.message : 'it is not allowed by the outbound policy'

  return `${name} was not added: ${reason}`
}

function sizeNotice(name: string, bytes: number): string {
  return (
    `${name} was not added: its tool declaration is ${String(bytes)} bytes, which would exceed ` +
    `Antigravity's ${String(ANTIGRAVITY_DECLARATION_BUDGET)}-byte MCP budget and drop other tools with no error.`
  )
}

function unreadNotice(name: string): string {
  return (
    `${name} was not added: its tool list could not be read. Antigravity drops tools that do not ` +
    'fit its budget, with no error, so an unread server is left out.'
  )
}

function openHeaders(server: TeamMcpServer): { name: string; value: string }[] | undefined {
  try {
    return server.headers.map((header) => ({
      name: header.name,
      value: decryptCustomMcpSecret(header.value),
    }))
  } catch {
    return undefined
  }
}

type ListDeclaration = NonNullable<AssembleMcpServersArgs['listDeclaration']>

// Antigravity shares one declaration budget across every MCP server (#4148). A server
// that does not fit is omitted; attaching it would drop other tools with no error.
async function antigravityRoom(
  server: TeamMcpServer,
  headers: { name: string; value: string }[],
  used: number,
  listDeclaration: ListDeclaration,
): Promise<{ notice?: string; used: number }> {
  let declared: Declaration

  try {
    declared = await listDeclaration({ url: server.url, headers })
  } catch {
    return { used, notice: unreadNotice(server.name) }
  }
  const bytes = declarationBytes(declared.tools, declared.instructions)

  if (!customDeclarationFits(used, bytes)) return { used, notice: sizeNotice(server.name, bytes) }

  return { used: used + bytes }
}

/**
 * Selected servers as ACP HTTP entries, in selection order.
 *
 * The runtime dials `url` itself. `OUTBOUND_*` applies here, when the URL is handed
 * over: `resolvePublicTarget` refuses a blocked or private host unless
 * `OUTBOUND_ALLOW_PRIVATE_HOSTS` is set, and a refused server is omitted. The runtime's
 * later connection is not pinned. On Antigravity, `tools/list` goes through `pinnedFetch`.
 * Header values are decrypted only into the ACP entry.
 */
export async function assembleConversationMcpServers(
  args: AssembleMcpServersArgs,
): Promise<ConversationMcpServers> {
  const antigravity = args.agentRuntime === 'antigravity'
  const checkEgress = args.checkEgress ?? defaultEgress
  const listDeclaration =
    args.listDeclaration ??
    ((input: { url: string; headers: { name: string; value: string }[] }) =>
      listRemoteMcpDeclaration(input.url, input.headers))
  const byId = new Map(args.servers.map((server) => [server._id.toHexString(), server]))
  const notices: string[] = []
  const servers: AcpHttpMcpServer[] = []
  let used = antigravity ? (args.reservedBytes ?? ANTIGRAVITY_NUPHOS_RESERVE) : args.reservedBytes

  for (const id of args.selectedIds) {
    const server = byId.get(id)

    if (!server) {
      notices.push(`MCP server ${id} is selected but is not registered for this team.`)
      continue
    }
    const headers = openHeaders(server)

    if (!headers) {
      notices.push(
        `${server.name} was not added: its headers could not be decrypted. Re-enter them.`,
      )
      continue
    }
    try {
      await checkEgress(server.url)
    } catch (err) {
      notices.push(egressNotice(server.name, err))
      continue
    }
    if (antigravity) {
      const room = await antigravityRoom(server, headers, used ?? 0, listDeclaration)

      if (room.notice) {
        notices.push(room.notice)
        continue
      }
      used = room.used
    }
    servers.push({ name: server.name, type: 'http', url: server.url, headers })
  }
  args.log?.(customMcpLogFields(servers, notices))

  return { servers, notices }
}

/**
 * Selected team MCP servers for one conversation. A task under a Bot uses the Bot's
 * selection, the same way its other connectors do. Unselected servers are not loaded.
 */
export async function selectedConversationMcpServers(args: {
  conversationId: string
  teamId: string
  agentRuntime?: string
}): Promise<ConversationMcpServers> {
  const empty: ConversationMcpServers = { servers: [], notices: [] }
  let source: Awaited<ReturnType<typeof credentialSourceOf>>

  try {
    source = await credentialSourceOf(args.conversationId)
  } catch (err) {
    if (databaseDisconnected(err)) return empty
    logError('agent.mcp.selection_unreadable', err, {
      session_id: args.conversationId,
      team_id: args.teamId,
    })

    return { servers: [], notices: [LOAD_NOTICE] }
  }
  if (source?.teamId !== args.teamId) return empty
  const selectedIds = source.credentialAccess?.mcpServerIds ?? []

  if (selectedIds.length === 0) return empty
  const ids = objectIds(selectedIds)
  const found =
    ids.length === 0
      ? []
      : await teamMcpServers()
          .find({ teamId: args.teamId, _id: { $in: ids } })
          .toArray()
  const built = await assembleConversationMcpServers({
    selectedIds,
    servers: found,
    agentRuntime: args.agentRuntime ?? source.agentRuntime,
  })

  logEvent('info', 'agent.mcp.custom_servers', {
    session_id: args.conversationId,
    team_id: args.teamId,
    runtime: args.agentRuntime ?? source.agentRuntime,
    ...customMcpLogFields(built.servers, built.notices),
  })

  return built
}
