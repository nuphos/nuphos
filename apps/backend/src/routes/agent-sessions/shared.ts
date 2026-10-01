import { ObjectId } from 'mongodb'

import { dashboardPanelIdFromSessionId } from '@/lib/dashboards/panel-principal'
import { agentConversations } from '@/lib/agent/db'
import { agentSubjectId } from '@/lib/agents/identity'
import { AppError } from '@/lib/errors'
import { dashboardPanels } from '@/models'
import { allCredentialAccessFromOptions } from '@/routes/agent/credential-access'
import { getAgentCredentialOptions } from '@/routes/agent/credential-options'

import type { AgentRef } from '@/lib/agents/identity'
import type {
  AuthVariables,
  AwsAccountVariables,
  GcpProjectVariables,
  LinodeAccountVariables,
  HetznerAccountVariables,
  BetterStackIntegrationVariables,
  UptimeKumaInstanceVariables,
  LinearWorkspaceVariables,
  JiraSiteVariables,
  AsanaAccountVariables,
  PosthogIntegrationVariables,
  ResendIntegrationVariables,
  SentryAccountVariables,
  TailscaleClientVariables,
  ZeaburProviderVariables,
} from '@/middleware/auth'
import type { AgentCredentialOptions } from '@/routes/agent/types'

export type AgentVars = AuthVariables & {
  agent: AgentRef
}
export type AgentAwsVars = AgentVars & AwsAccountVariables
export type AgentGcpVars = AgentVars & GcpProjectVariables
export type AgentLinodeVars = AgentVars & LinodeAccountVariables
export type AgentHetznerVars = AgentVars & HetznerAccountVariables
export type AgentBetterStackVars = AgentVars & BetterStackIntegrationVariables
export type AgentUptimeKumaVars = AgentVars & UptimeKumaInstanceVariables
export type AgentLinearVars = AgentVars & LinearWorkspaceVariables
export type AgentJiraVars = AgentVars & JiraSiteVariables
export type AgentAsanaVars = AgentVars & AsanaAccountVariables
export type AgentPosthogVars = AgentVars & PosthogIntegrationVariables
export type AgentResendVars = AgentVars & ResendIntegrationVariables
export type AgentSentryVars = AgentVars & SentryAccountVariables
export type AgentTailscaleVars = AgentVars & TailscaleClientVariables
export type AgentZeaburVars = AgentVars & ZeaburProviderVariables

export function execCredentialResponse(
  c: { header(name: string, value: string): void; json(object: unknown): Response },
  agent: AgentRef,
  token: string,
  expiresAt: Date,
): Response {
  c.header('Cache-Control', 'no-store')
  c.header('X-Atlas-Agent', agentSubjectId(agent))

  return c.json({
    apiVersion: 'client.authentication.k8s.io/v1',
    kind: 'ExecCredential',
    status: {
      token,
      expirationTimestamp: expiresAt.toISOString(),
    },
  })
}

/** A panel without its own selection gets what a new conversation starts with. */
async function dashboardPanelCredentialAccess(panelId: ObjectId, agent: AgentRef, teamId: string) {
  const panel = ObjectId.isValid(teamId)
    ? await dashboardPanels().findOne(
        { _id: panelId, teamId: new ObjectId(teamId) },
        { projection: { credentialAccess: 1 } },
      )
    : null

  if (!panel) throw new AppError(403, 'forbidden', 'Dashboard panel not found')
  if (panel.credentialAccess) return normalizeCredentialAccess(panel.credentialAccess)

  return normalizeCredentialAccess(
    allCredentialAccessFromOptions(
      await getAgentCredentialOptions(teamId, agent.userId),
      agent.userId,
    ),
  )
}

export async function getAgentCredentialAccess(agent: AgentRef, teamId: string) {
  const panelId = dashboardPanelIdFromSessionId(agent.sessionId)

  if (panelId) return dashboardPanelCredentialAccess(panelId, agent, teamId)
  const conversationOwnerUserId = agent.conversationOwnerUserId ?? agent.userId
  const teamConversation = await agentConversations().findOne(
    {
      sessionId: agent.sessionId,
      userId: conversationOwnerUserId,
      teamId,
    },
    { projection: { credentialAccess: 1, 'metadata.source': 1 } },
  )
  const conversation =
    teamConversation ??
    (await agentConversations().findOne(
      {
        sessionId: agent.sessionId,
        userId: conversationOwnerUserId,
        teamId: { $exists: false },
      },
      { projection: { credentialAccess: 1, 'metadata.source': 1 } },
    ))

  if (!conversation) {
    throw new AppError(403, 'forbidden', 'Session not found or not owned by caller')
  }

  // Never reuse the owner's persisted credential selection for another
  // teammate. Shared-channel turns derive a fresh upper bound from the
  // execution actor's current allow lists, so revocation takes effect on the
  // next request and cross-user credential confused-deputy access is closed.
  if (agent.userId !== conversationOwnerUserId) {
    const options = await getAgentCredentialOptions(teamId, agent.userId)

    return credentialAccessForExecution(
      agent,
      conversation.credentialAccess,
      options,
      conversation.metadata?.source === 'slack.agent' ||
        conversation.metadata?.source === 'discord.agent',
    )
  }

  return credentialAccessForExecution(agent, conversation.credentialAccess)
}

/** Pure policy seam used by the concurrency/security model tests. */
export function credentialAccessForExecution(
  agent: AgentRef,
  ownerSelection: Parameters<typeof normalizeCredentialAccess>[0],
  actorOptions?: AgentCredentialOptions,
  selectAll = false,
) {
  const conversationOwnerUserId = agent.conversationOwnerUserId ?? agent.userId

  if (agent.userId === conversationOwnerUserId) return normalizeCredentialAccess(ownerSelection)
  // Missing discovery must fail closed; it must never fall back to ownerSelection.
  if (!actorOptions) return normalizeCredentialAccess(undefined)

  return normalizeCredentialAccess(
    allCredentialAccessFromOptions(actorOptions, agent.userId, selectAll),
  )
}

function normalizeCredentialAccess(
  access: Partial<ReturnType<typeof allCredentialAccessFromOptions>> | undefined,
) {
  return {
    awsRoleIds: access?.awsRoleIds ?? [],
    gcpServiceAccountIds: access?.gcpServiceAccountIds ?? [],
    linodeAccountIds: access?.linodeAccountIds ?? [],
    hetznerAccountIds: access?.hetznerAccountIds ?? [],
    tencentAccountIds: access?.tencentAccountIds ?? [],
    aliyunAccountIds: access?.aliyunAccountIds ?? [],
    volcengineAccountIds: access?.volcengineAccountIds ?? [],
    azureAccountIds: access?.azureAccountIds ?? [],
    huaweiAccountIds: access?.huaweiAccountIds ?? [],
    onpremClusterIds: access?.onpremClusterIds ?? [],
    betterStackIntegrationIds: access?.betterStackIntegrationIds ?? [],
    uptimeKumaInstanceIds: access?.uptimeKumaInstanceIds ?? [],
    linearWorkspaceIds: access?.linearWorkspaceIds ?? [],
    jiraSiteIds: access?.jiraSiteIds ?? [],
    asanaAccountIds: access?.asanaAccountIds ?? [],
    sentryAccountIds: access?.sentryAccountIds ?? [],
    tailscaleClientIds: access?.tailscaleClientIds ?? [],
    zeaburIds: access?.zeaburIds ?? [],
    vantaIntegrationIds: access?.vantaIntegrationIds ?? [],
    secureframeIntegrationIds: access?.secureframeIntegrationIds ?? [],
    resendIntegrationIds: access?.resendIntegrationIds ?? [],
    posthogIntegrationIds: access?.posthogIntegrationIds ?? [],
    // Left undefined when unset rather than defaulted to []: for these
    // connectors an absent selection still means team-wide reach.
    githubInstallationIds: access?.githubInstallationIds,
    gitlabBindingIds: access?.gitlabBindingIds,
    grafanaInstanceIds: access?.grafanaInstanceIds,
    sonarqubeIntegrationIds: access?.sonarqubeIntegrationIds,
    notionIntegrationIds: access?.notionIntegrationIds,
    upstashAccountIds: access?.upstashAccountIds,
    cloudflareAccountIds: access?.cloudflareAccountIds,
    deviceIds: access?.deviceIds ?? [],
  }
}
