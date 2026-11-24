import { ipcRenderer } from 'electron'

import type { McpServerInput } from '../../src/types/mcp-servers'

export const mcpServersApi = {
  atlasListMcpServers: (teamId: string) => ipcRenderer.invoke('atlas:listMcpServers', teamId),
  atlasCreateMcpServer: (teamId: string, input: McpServerInput) =>
    ipcRenderer.invoke('atlas:createMcpServer', teamId, input),
  atlasUpdateMcpServer: (teamId: string, serverId: string, input: Partial<McpServerInput>) =>
    ipcRenderer.invoke('atlas:updateMcpServer', teamId, serverId, input),
  atlasDeleteMcpServer: (teamId: string, serverId: string) =>
    ipcRenderer.invoke('atlas:deleteMcpServer', teamId, serverId),
}
