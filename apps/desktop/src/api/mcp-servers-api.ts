import type { McpServerInput } from '../types/mcp-servers'

export const mcpServersApi = {
  atlasListMcpServers: (teamId: string) => window.api.atlasListMcpServers(teamId),
  atlasCreateMcpServer: (teamId: string, input: McpServerInput) =>
    window.api.atlasCreateMcpServer(teamId, input),
  atlasUpdateMcpServer: (teamId: string, serverId: string, input: Partial<McpServerInput>) =>
    window.api.atlasUpdateMcpServer(teamId, serverId, input),
  atlasDeleteMcpServer: (teamId: string, serverId: string) =>
    window.api.atlasDeleteMcpServer(teamId, serverId),
}
