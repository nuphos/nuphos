import { teamMcpServersRoutes } from '@/routes/team-mcp-servers'
import { teamWebhooksRoutes } from '@/routes/team-webhooks'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

/** Team endpoints an administrator registers: webhooks and remote MCP servers. */
export function registerTeamRemoteEndpointRoutes(
  teamScoped: Hono<{ Variables: TeamAuthVariables }>,
): void {
  teamScoped.route('/mcp-servers', teamMcpServersRoutes)
  teamScoped.route('/webhooks', teamWebhooksRoutes)
}
