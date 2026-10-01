import { getMyTeams } from '@/lib/identity'
import { getCapabilities, toolResult } from '@/lib/mcp/protocol'
import { nuphosAsk, nuphosCheck } from '@/routes/mcp/ask-check'
import { nuphosListCredentials, nuphosUpdateCredentials } from '@/routes/mcp/credentials'

import type { ToolHandler, ToolResult } from '@/lib/mcp/protocol'
import type { McpCallContext } from '@/routes/mcp/types'

async function nuphosListTeams(ctx: McpCallContext): Promise<ToolResult> {
  const teams = await getMyTeams(ctx.userId)

  return toolResult({
    teams: teams.map((team) => ({
      team_id: team.id,
      name: team.name,
      role: team.role ?? null,
    })),
  })
}

// Bind the tool implementations to the authenticated caller for a single request.
export function toolsForContext(ctx: McpCallContext): Record<string, ToolHandler> {
  return {
    nuphos_ask: (args) => nuphosAsk(args, ctx),
    nuphos_check: (args) => nuphosCheck(args, ctx),
    nuphos_list_teams: () => nuphosListTeams(ctx),
    nuphos_list_credentials: (args) => nuphosListCredentials(args, ctx),
    nuphos_update_credentials: (args) => nuphosUpdateCredentials(args, ctx),
    nuphos_capabilities: async () => toolResult(getCapabilities()),
  }
}
