import { db } from '@/lib/db'
import { blockedUrlReason, privateHostReason } from '@/lib/net/safe-outbound'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { Collection, ObjectId } from 'mongodb'

// Headers are secrets: a public URL is https, with no query or fragment.
// http is only for a private host when the deployment allows private hosts.
export function mcpServerUrlReason(raw: string): string | null {
  const blocked = blockedUrlReason(raw)

  if (blocked) return blocked
  const url = new URL(raw)

  if (url.search || url.hash) return 'URL must not contain a query or fragment'
  if (url.protocol === 'http:' && !privateHostReason(url)) return 'URL must be https://'

  return null
}

/** A remote MCP endpoint registered for one team. Header values are write-only. */
export type TeamMcpServer = {
  _id: ObjectId
  teamId: string
  name: string
  url: string
  /** Sent on later requests to this server; values are never returned by the API. */
  headers: { name: string; value: EncryptedSecret }[]
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export const teamMcpServers = (): Collection<TeamMcpServer> =>
  db().collection<TeamMcpServer>('team_mcp_servers')

export async function setupTeamMcpServerIndexes(): Promise<void> {
  await teamMcpServers().createIndex({ teamId: 1, createdAt: 1 }, { name: 'team_mcp_servers_team' })
}
