import { getConversationBySessionId, setConversationCredentialFields } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { resolveAgentCredentialAccess } from '@/routes/agent'

import type { AgentConversation } from '@/lib/agent/db'
import type { ToolResult } from '@/lib/mcp/protocol'
import type { McpCallContext } from '@/routes/mcp/types'

// Shared guard for tools that operate on an existing session: it must exist,
// belong to the caller, and live in the given team.
async function requireOwnSessionInTeam(
  sessionId: string,
  teamId: string,
  ctx: McpCallContext,
): Promise<AgentConversation | ToolResult> {
  const conversation = await getConversationBySessionId(sessionId)

  if (!conversation || conversation.userId !== ctx.userId) {
    return toolError(`Session not found: ${sessionId}`)
  }
  if ((conversation.teamId ?? undefined) !== teamId) {
    return toolError(`Session ${sessionId} belongs to a different team_id.`)
  }

  return conversation
}

function credentialAccessPayload(access: {
  awsRoleIds: string[]
  gcpServiceAccountIds: string[]
  linodeAccountIds: string[]
  hetznerAccountIds: string[]
  betterStackIntegrationIds: string[]
  uptimeKumaInstanceIds: string[]
  linearWorkspaceIds?: string[]
  jiraSiteIds: string[]
  asanaAccountIds: string[]
  sentryAccountIds?: string[]
  tailscaleClientIds: string[]
  zeaburIds: string[]
  vantaIntegrationIds: string[]
  secureframeIntegrationIds: string[]
  resendIntegrationIds?: string[]
}): Record<string, string[]> {
  return {
    aws_role_ids: access.awsRoleIds,
    gcp_service_account_ids: access.gcpServiceAccountIds,
    linode_account_ids: access.linodeAccountIds,
    hetzner_account_ids: access.hetznerAccountIds,
    betterstack_integration_ids: access.betterStackIntegrationIds,
    uptime_kuma_instance_ids: access.uptimeKumaInstanceIds,
    linear_workspace_ids: access.linearWorkspaceIds ?? [],
    jira_site_ids: access.jiraSiteIds,
    asana_account_ids: access.asanaAccountIds,
    sentry_account_ids: access.sentryAccountIds ?? [],
    tailscale_client_ids: access.tailscaleClientIds,
    zeabur_ids: access.zeaburIds,
    vanta_integration_ids: access.vantaIntegrationIds,
    secureframe_integration_ids: access.secureframeIntegrationIds,
    resend_integration_ids: access.resendIntegrationIds ?? [],
  }
}

export async function nuphosListCredentials(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const teamId = typeof args.team_id === 'string' && args.team_id.trim() ? args.team_id.trim() : ''

  if (!teamId) return toolError('`team_id` is required. Call nuphos_list_teams first.')
  const membership = await getTeamMembership(ctx.userId, teamId)

  if (!membership) return toolError(`You are not a member of team ${teamId}.`)

  const { options } = await resolveAgentCredentialAccess({ teamId, userId: ctx.userId })

  const sessionId =
    typeof args.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : ''
  let enabled: Record<string, string[]> | undefined

  if (sessionId) {
    const conversation = await requireOwnSessionInTeam(sessionId, teamId, ctx)

    if (!('sessionId' in conversation)) return conversation
    // No stored allowlist means the next run defaults to everything listed.
    enabled = conversation.credentialAccess
      ? credentialAccessPayload(conversation.credentialAccess)
      : undefined
  }

  return toolResult({
    team_id: teamId,
    options,
    ...(sessionId
      ? {
          session_id: sessionId,
          enabled_for_session: enabled ?? 'all (no explicit selection stored yet)',
        }
      : {}),
  })
}

// The categories nuphos_update_credentials replaces, by tool argument. It has no
// parameter for the others (local devices, on-prem, connectors), so it never
// writes them.
const NAMED_CATEGORIES = {
  awsRoleIds: 'aws_role_ids',
  gcpServiceAccountIds: 'gcp_service_account_ids',
  linodeAccountIds: 'linode_account_ids',
  hetznerAccountIds: 'hetzner_account_ids',
  betterStackIntegrationIds: 'betterstack_integration_ids',
  uptimeKumaInstanceIds: 'uptime_kuma_instance_ids',
  linearWorkspaceIds: 'linear_workspace_ids',
  jiraSiteIds: 'jira_site_ids',
  asanaAccountIds: 'asana_account_ids',
  sentryAccountIds: 'sentry_account_ids',
  tailscaleClientIds: 'tailscale_client_ids',
  zeaburIds: 'zeabur_ids',
  vantaIntegrationIds: 'vanta_integration_ids',
  secureframeIntegrationIds: 'secureframe_integration_ids',
  resendIntegrationIds: 'resend_integration_ids',
} as const

export async function nuphosUpdateCredentials(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const teamId = typeof args.team_id === 'string' && args.team_id.trim() ? args.team_id.trim() : ''
  const sessionId =
    typeof args.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : ''

  if (!teamId || !sessionId) return toolError('`session_id` and `team_id` are required.')
  const membership = await getTeamMembership(ctx.userId, teamId)

  if (!membership) return toolError(`You are not a member of team ${teamId}.`)
  const conversation = await requireOwnSessionInTeam(sessionId, teamId, ctx)

  if (!('sessionId' in conversation)) return conversation

  try {
    const { access } = await resolveAgentCredentialAccess({
      teamId,
      userId: ctx.userId,
      selection: Object.fromEntries(
        Object.entries(NAMED_CATEGORIES).map(([key, arg]) => [key, args[arg] ?? []]),
      ),
    })
    // Write only what this tool names; the rest of the selection is not read
    // back and rewritten, so an edit made meanwhile in the picker survives.
    const updated = await setConversationCredentialFields(
      sessionId,
      ctx.userId,
      teamId,
      Object.fromEntries(
        Object.keys(NAMED_CATEGORIES).map((key) => [key, access[key as keyof typeof access]]),
      ),
    )

    if (!updated?.credentialAccess) return toolError(`Session not found: ${sessionId}`)

    return toolResult({
      session_id: sessionId,
      team_id: teamId,
      enabled_for_session: credentialAccessPayload(updated.credentialAccess),
    })
  } catch (err) {
    if (err instanceof AppError) return toolError(err.message)
    throw err
  }
}
