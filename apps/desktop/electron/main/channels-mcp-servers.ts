import * as atlas from '../atlas/mcp-servers'

import type { McpServerInput } from '../../src/types/mcp-servers'

export const mcpServersChannels = {
  'atlas:listMcpServers': (_e: unknown, teamId: string) => atlas.listMcpServers(teamId),
  'atlas:createMcpServer': (_e: unknown, teamId: string, input: McpServerInput) =>
    atlas.createMcpServer(teamId, input),
  'atlas:updateMcpServer': (
    _e: unknown,
    teamId: string,
    serverId: string,
    input: Partial<McpServerInput>,
  ) => atlas.updateMcpServer(teamId, serverId, input),
  'atlas:deleteMcpServer': (_e: unknown, teamId: string, serverId: string) =>
    atlas.deleteMcpServer(teamId, serverId),
}
