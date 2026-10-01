import { getConversationBySessionId, updateConversationCredentialAccess } from '@/lib/agent/db'
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
      selection: {
        awsRoleIds: args.aws_role_ids,
        gcpServiceAccountIds: args.gcp_service_account_ids,
        linodeAccountIds: args.linode_account_ids,
        hetznerAccountIds: args.hetzner_account_ids,
        betterStackIntegrationIds: args.betterstack_integration_ids,
        uptimeKumaInstanceIds: args.uptime_kuma_instance_ids,
        linearWorkspaceIds: args.linear_workspace_ids,
        jiraSiteIds: args.jira_site_ids,
        asanaAccountIds: args.asana_account_ids,
        sentryAccountIds: args.sentry_account_ids,
        tailscaleClientIds: args.tailscale_client_ids,
        zeaburIds: args.zeabur_ids,
        vantaIntegrationIds: args.vanta_integration_ids,
        secureframeIntegrationIds: args.secureframe_integration_ids,
        resendIntegrationIds: args.resend_integration_ids,
      },
    })
    const updated = await updateConversationCredentialAccess(sessionId, ctx.userId, teamId, access)

    if (!updated) return toolError(`Session not found: ${sessionId}`)

    return toolResult({
      session_id: sessionId,
      team_id: teamId,
      enabled_for_session: credentialAccessPayload(access),
    })
  } catch (err) {
    if (err instanceof AppError) return toolError(err.message)
    throw err
  }
}
