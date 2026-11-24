import { db } from '@/lib/db'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { Collection, ObjectId } from 'mongodb'

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
