import { getMyTeams } from '@/lib/identity'
import { getCapabilities, toolResult } from '@/lib/mcp/protocol'
import { nuphosAsk } from '@/routes/mcp/ask'
import { nuphosCheck } from '@/routes/mcp/check'
import {
  nuphosEvents,
  nuphosListQueue,
  nuphosListRuntimes,
  nuphosRemoveQueued,
  nuphosStop,
} from '@/routes/mcp/control'
import { nuphosListCredentials, nuphosUpdateCredentials } from '@/routes/mcp/credentials'
import { nuphosFiles } from '@/routes/mcp/files'
import { nuphosFindPrSessions } from '@/routes/mcp/resources'
import { nuphosListSessions, nuphosUpdateSession } from '@/routes/mcp/sessions'

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
    nuphos_list_runtimes: (args) => nuphosListRuntimes(args, ctx),
    nuphos_list_sessions: (args) => nuphosListSessions(args, ctx),
    nuphos_events: (args) => nuphosEvents(args, ctx),
    nuphos_stop: (args) => nuphosStop(args, ctx),
    nuphos_list_queue: (args) => nuphosListQueue(args, ctx),
    nuphos_remove_queued: (args) => nuphosRemoveQueued(args, ctx),
    nuphos_update_session: (args) => nuphosUpdateSession(args, ctx),
    nuphos_list_credentials: (args) => nuphosListCredentials(args, ctx),
    nuphos_update_credentials: (args) => nuphosUpdateCredentials(args, ctx),
    nuphos_files: (args) => nuphosFiles(args, ctx),
    nuphos_find_pr_sessions: (args) => nuphosFindPrSessions(args, ctx),
    nuphos_capabilities: async () => toolResult(getCapabilities()),
  }
}
