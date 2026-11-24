import { call } from './client'

import type { McpServerInput, TeamMcpServer } from '../../src/types/mcp-servers'

function path(teamId: string, serverId?: string): string {
  const base = `/teams/${encodeURIComponent(teamId)}/mcp-servers`

  return serverId ? `${base}/${encodeURIComponent(serverId)}` : base
}

export async function listMcpServers(teamId: string): Promise<TeamMcpServer[]> {
  const res = await call<{ mcpServers: TeamMcpServer[] }>('GET', path(teamId))

  return res.mcpServers
}

export async function createMcpServer(
  teamId: string,
  input: McpServerInput,
): Promise<TeamMcpServer> {
  const res = await call<{ mcpServer: TeamMcpServer }>('POST', path(teamId), input, {
    retry: false,
  })

  return res.mcpServer
}

export async function updateMcpServer(
  teamId: string,
  serverId: string,
  input: Partial<McpServerInput>,
): Promise<TeamMcpServer> {
  const res = await call<{ mcpServer: TeamMcpServer }>('PATCH', path(teamId, serverId), input, {
    retry: false,
  })

  return res.mcpServer
}

export async function deleteMcpServer(teamId: string, serverId: string): Promise<void> {
  await call('DELETE', path(teamId, serverId), undefined, { retry: false })
}
