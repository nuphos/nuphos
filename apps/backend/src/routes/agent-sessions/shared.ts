import { ObjectId } from 'mongodb'

import { dashboardPanelIdFromSessionId } from '@/lib/dashboards/panel-principal'
import { agentConversations } from '@/lib/agent/db'
import { agentSubjectId } from '@/lib/agents/identity'
import { canMintCredentials, isCloudCredentialPath } from '@/lib/byos/credential-role'
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
  TeamAuthVariables,
  ZeaburProviderVariables,
} from '@/middleware/auth'
import type { AgentCredentialOptions } from '@/routes/agent/types'
import type { MiddlewareHandler } from 'hono'

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

/**
 * The credentials a request may vend: the conversation's selection, narrowed
 * to an exchanged token's limit when it carries one. A field the conversation
 * leaves unset (team-wide reach) narrows to exactly the limit's ids.
 */
export async function getAgentCredentialAccess(agent: AgentRef, teamId: string) {
  const access = await selectedCredentialAccess(agent, teamId)

  return agent.credentialLimit ? limitCredentialAccess(access, agent.credentialLimit) : access
}

export function limitCredentialAccess<T extends Record<string, unknown>>(
  access: T,
  limit: Readonly<Record<string, readonly string[]>>,
): T {
  const limited: Record<string, unknown> = { ...access }

  for (const [key, selected] of Object.entries(access)) {
    if (selected !== undefined && !Array.isArray(selected)) continue
    const allowed = limit[key] ?? []

    limited[key] = selected
      ? (selected as string[]).filter((id) => allowed.includes(id))
      : [...allowed]
  }

  return limited as T
}

async function selectedCredentialAccess(agent: AgentRef, teamId: string) {
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

/** A stored list that is not an array of ids (null, a scalar) reaches nothing. */
function credentialIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/** As `credentialIds`, but absent stays absent: for these connectors it means team-wide reach. */
function optionalCredentialIds(value: unknown): string[] | undefined {
  return value === undefined ? undefined : credentialIds(value)
}

/** The one boundary stored selections pass through: a malformed list fails closed, never wider. */
export function normalizeCredentialAccess(
  access:
    Partial<Record<keyof ReturnType<typeof allCredentialAccessFromOptions>, unknown>> | undefined,
) {
  return {
    awsRoleIds: credentialIds(access?.awsRoleIds),
    gcpServiceAccountIds: credentialIds(access?.gcpServiceAccountIds),
    linodeAccountIds: credentialIds(access?.linodeAccountIds),
    hetznerAccountIds: credentialIds(access?.hetznerAccountIds),
    tencentAccountIds: credentialIds(access?.tencentAccountIds),
    aliyunAccountIds: credentialIds(access?.aliyunAccountIds),
    volcengineAccountIds: credentialIds(access?.volcengineAccountIds),
    azureAccountIds: credentialIds(access?.azureAccountIds),
    huaweiAccountIds: credentialIds(access?.huaweiAccountIds),
    onpremClusterIds: credentialIds(access?.onpremClusterIds),
    betterStackIntegrationIds: credentialIds(access?.betterStackIntegrationIds),
    uptimeKumaInstanceIds: credentialIds(access?.uptimeKumaInstanceIds),
    linearWorkspaceIds: credentialIds(access?.linearWorkspaceIds),
    jiraSiteIds: credentialIds(access?.jiraSiteIds),
    asanaAccountIds: credentialIds(access?.asanaAccountIds),
    sentryAccountIds: credentialIds(access?.sentryAccountIds),
    tailscaleClientIds: credentialIds(access?.tailscaleClientIds),
    zeaburIds: credentialIds(access?.zeaburIds),
    vantaIntegrationIds: credentialIds(access?.vantaIntegrationIds),
    secureframeIntegrationIds: credentialIds(access?.secureframeIntegrationIds),
    resendIntegrationIds: credentialIds(access?.resendIntegrationIds),
    posthogIntegrationIds: credentialIds(access?.posthogIntegrationIds),
    plaudAccountIds: credentialIds(access?.plaudAccountIds),
    // Left undefined when unset rather than defaulted to []: for these
    // connectors an absent selection still means team-wide reach.
    githubInstallationIds: optionalCredentialIds(access?.githubInstallationIds),
    gitlabBindingIds: optionalCredentialIds(access?.gitlabBindingIds),
    grafanaInstanceIds: optionalCredentialIds(access?.grafanaInstanceIds),
    sonarqubeIntegrationIds: optionalCredentialIds(access?.sonarqubeIntegrationIds),
    notionIntegrationIds: optionalCredentialIds(access?.notionIntegrationIds),
    upstashAccountIds: optionalCredentialIds(access?.upstashAccountIds),
    cloudflareAccountIds: optionalCredentialIds(access?.cloudflareAccountIds),
    instaboxAccountIds: optionalCredentialIds(access?.instaboxAccountIds),
    personalCredentialIds: credentialIds(access?.personalCredentialIds).filter(
      (id): id is 'github' | 'linear' => id === 'github' || id === 'linear',
    ),
    deviceIds: credentialIds(access?.deviceIds),
  }
}

/** Everyone a credential request acts for: the sender and the conversation owner. */
export function agentPrincipals(c: {
  get(key: 'userId'): string
  get(key: 'agent'): AgentRef
}): string[] {
  const agent = c.get('agent')

  return [c.get('userId'), agent.userId, agent.conversationOwnerUserId ?? agent.userId]
}

/** Writes through a connector the team shares are editor-level, for every principal. */
export function requireAgentWriteRole(): MiddlewareHandler<{
  Variables: AgentVars & TeamAuthVariables
}> {
  return async (c, next) => {
    if (!(await canMintCredentials(c.get('teamId'), agentPrincipals(c)))) {
      throw new AppError(403, 'forbidden', 'Requires one of: ADMINISTRATOR, EDITOR')
    }
    await next()
  }
}

/** Cloud credential and kubeconfig vending is write-level: refuse it when the
 * sender or the conversation owner is a team viewer (dashboard panels act as
 * their author). */
export function requireCloudCredentialRole(): MiddlewareHandler<{
  Variables: AgentVars & TeamAuthVariables
}> {
  return async (c, next) => {
    if (isCloudCredentialPath(c.req.path)) {
      if (!(await canMintCredentials(c.get('teamId'), agentPrincipals(c)))) {
        throw new AppError(403, 'forbidden', 'Requires one of: ADMINISTRATOR, EDITOR')
      }
    }
    await next()
  }
}
