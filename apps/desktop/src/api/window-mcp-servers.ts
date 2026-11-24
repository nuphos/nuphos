import type { McpServerInput, TeamMcpServer } from '../types/mcp-servers'

export type WindowMcpServersApi = {
  atlasListMcpServers(teamId: string): Promise<TeamMcpServer[]>
  atlasCreateMcpServer(teamId: string, input: McpServerInput): Promise<TeamMcpServer>
  atlasUpdateMcpServer(
    teamId: string,
    serverId: string,
    input: Partial<McpServerInput>,
  ): Promise<TeamMcpServer>
  atlasDeleteMcpServer(teamId: string, serverId: string): Promise<void>
}
