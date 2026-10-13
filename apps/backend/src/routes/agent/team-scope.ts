import type { AgentCredentialSelection } from './types'
import type { AgentConversation } from '@/lib/agent/db'
import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

import { getConversationBySessionId, getConversationWithMessages } from '@/lib/agent/db'
import { canReply, conversationAccess } from '@/lib/agent/db/access'
import { parseUrlContext } from '@/lib/agent/url-context'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { isTeamIdShape } from '@/lib/team-id'

export function normalizeOptionalTeamId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()

  return trimmed || undefined
}

function teamIdFromCurrentUrl(currentUrl: string | null): string | undefined {
  if (!currentUrl) return undefined
  try {
    const url = new URL(currentUrl, 'https://nuphos.ai')

    return parseUrlContext(url.pathname, url.searchParams).teamId
  } catch {
    return undefined
  }
}

/**
 * The X-Atlas-Kube-Context header is interpolated verbatim into a system
 * message ("the user's current desktop workspace tab is bound to kubeconfig
 * context X"). That makes it a prompt-injection surface for anyone who can
 * set headers on /agent/chat (any authenticated caller, not just the
 * desktop). Allow only the character set real kubeconfig context names use,
 * up to a sane length — legitimate names are short identifiers like
 * `arn:aws:eks:us-east-1:123:cluster/foo` or `docker-desktop`, so this
 * filter rejects nothing real while eliminating quote-break / newline /
 * "ignore previous instructions" payloads.
 */
export function sanitizeKubeContextHeader(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  if (raw.length > 200) return undefined
  // Kubernetes context names per kubectl docs are DNS-style; in practice
  // EKS/GKE-generated names also include `:` `/` `.` `@`. Whitelist that
  // superset; reject anything else (notably quotes, backticks, newlines,
  // angle brackets — all the prompt-injection enablers).
  if (!/^[A-Za-z0-9._:/@-]+$/.test(raw)) return undefined

  return raw
}

/**
 * Return the candidate teamId only if the authenticated caller is actually a
 * member of that team. Every client-supplied source of teamId (request body,
 * query string, X-Atlas-Url, referer, origin) is verified against Nuphos
 * team membership before being stored on conversations or used as a filter,
 * so a client can't forge or reassign conversations to teams they don't belong
 * to.
 *
 * Returns `undefined` when the candidate is missing, malformed, or the caller
 * is not a member.
 */
export async function resolveVerifiedTeamId(
  c: Context<{ Variables: AuthVariables }>,
  candidate: string | undefined,
): Promise<string | undefined> {
  if (!candidate) return undefined
  if (!isTeamIdShape(candidate)) return undefined
  const userId = c.get('userId')
  const membership = await getTeamMembership(userId, candidate)

  return membership ? candidate : undefined
}

export async function assertConversationWritable(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
): Promise<AgentConversation | null> {
  const existingConversation = await getConversationBySessionId(sessionId)

  if (existingConversation && existingConversation.userId !== userId) {
    throw new AppError(403, 'conversation_read_only', 'You can only view this team conversation')
  }
  if (existingConversation && (existingConversation.teamId ?? undefined) !== teamId) {
    throw new AppError(
      409,
      'conversation_scope_mismatch',
      'Conversation belongs to a different team scope',
    )
  }

  return existingConversation
}

/** Sending needs reply access; management and transcript replacement remain owner-only. */
export async function assertConversationSendable(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
): Promise<AgentConversation | null> {
  const conversation = await getConversationBySessionId(sessionId)

  if (!conversation) return null
  if ((conversation.teamId ?? undefined) !== teamId)
    throw new AppError(
      409,
      'conversation_scope_mismatch',
      'Conversation belongs to a different team scope',
    )
  if (conversation.userId !== userId && (!teamId || !(await getTeamMembership(userId, teamId))))
    throw new AppError(403, 'forbidden', 'You are not a member of this conversation’s team')
  if (!canReply(conversationAccess(conversation, userId)))
    throw new AppError(403, 'conversation_read_only', 'You can only view this conversation')

  return conversation
}

export async function resolveReadableConversationForResume(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
): Promise<AgentConversation> {
  const result = await getConversationWithMessages(sessionId, userId, teamId)

  if (!result) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }

  return result.conversation
}

export function readTeamIdCandidate(c: Context, bodyTeamId?: unknown): string | undefined {
  const body = normalizeOptionalTeamId(bodyTeamId)
  const query = normalizeOptionalTeamId(c.req.query('teamId'))
  const url = teamIdFromCurrentUrl(
    c.req.header('X-Atlas-Url') ?? c.req.header('referer') ?? c.req.header('origin') ?? null,
  )

  // Reject conflicting sources up front: a stale body.teamId that disagrees
  // with the page/URL the user is actually on is almost always a bug or an
  // attempt to bypass the page scope.
  if ((body && query && body !== query) || (body && url && body !== url)) {
    throw new AppError(400, 'invalid_request', 'Conflicting teamId sources')
  }

  // Prefer explicit page/query scope over body — the URL is the user's
  // actual current context.
  return query ?? url ?? body
}

export function normalizeCredentialSelection(input: unknown): AgentCredentialSelection {
  if (!input || typeof input !== 'object') {
    return {
      awsRoleIds: [],
      gcpServiceAccountIds: [],
      linodeAccountIds: [],
      hetznerAccountIds: [],
      tencentAccountIds: [],
      aliyunAccountIds: [],
      volcengineAccountIds: [],
      azureAccountIds: [],
      huaweiAccountIds: [],
      onpremClusterIds: [],
      betterStackIntegrationIds: [],
      uptimeKumaInstanceIds: [],
      linearWorkspaceIds: [],
      jiraSiteIds: [],
      asanaAccountIds: [],
      sentryAccountIds: [],
      tailscaleClientIds: [],
      zeaburIds: [],
      vantaIntegrationIds: [],
      secureframeIntegrationIds: [],
      resendIntegrationIds: [],
      posthogIntegrationIds: [],
      deviceIds: [],
    }
  }
  const raw = input as Record<string, unknown>

  return {
    awsRoleIds: normalizeObjectIdList(raw.awsRoleIds, 'awsRoleIds'),
    gcpServiceAccountIds: normalizeObjectIdList(raw.gcpServiceAccountIds, 'gcpServiceAccountIds'),
    linodeAccountIds: normalizeObjectIdList(raw.linodeAccountIds, 'linodeAccountIds'),
    hetznerAccountIds: normalizeObjectIdList(raw.hetznerAccountIds, 'hetznerAccountIds'),
    tencentAccountIds: normalizeObjectIdList(raw.tencentAccountIds, 'tencentAccountIds'),
    aliyunAccountIds: normalizeObjectIdList(raw.aliyunAccountIds, 'aliyunAccountIds'),
    volcengineAccountIds: normalizeObjectIdList(raw.volcengineAccountIds, 'volcengineAccountIds'),
    azureAccountIds: normalizeObjectIdList(raw.azureAccountIds, 'azureAccountIds'),
    huaweiAccountIds: normalizeObjectIdList(raw.huaweiAccountIds, 'huaweiAccountIds'),
    onpremClusterIds: normalizeObjectIdList(raw.onpremClusterIds, 'onpremClusterIds'),
    betterStackIntegrationIds: normalizeObjectIdList(
      raw.betterStackIntegrationIds,
      'betterStackIntegrationIds',
    ),
    uptimeKumaInstanceIds: normalizeObjectIdList(
      raw.uptimeKumaInstanceIds,
      'uptimeKumaInstanceIds',
    ),
    linearWorkspaceIds: normalizeObjectIdList(raw.linearWorkspaceIds, 'linearWorkspaceIds'),
    jiraSiteIds: normalizeObjectIdList(raw.jiraSiteIds, 'jiraSiteIds'),
    asanaAccountIds: normalizeObjectIdList(raw.asanaAccountIds, 'asanaAccountIds'),
    sentryAccountIds: normalizeObjectIdList(raw.sentryAccountIds, 'sentryAccountIds'),
    tailscaleClientIds: normalizeObjectIdList(raw.tailscaleClientIds, 'tailscaleClientIds'),
    zeaburIds: normalizeStringList(raw.zeaburIds, 'zeaburIds'),
    vantaIntegrationIds: normalizeObjectIdList(raw.vantaIntegrationIds, 'vantaIntegrationIds'),
    secureframeIntegrationIds: normalizeObjectIdList(
      raw.secureframeIntegrationIds,
      'secureframeIntegrationIds',
    ),
    resendIntegrationIds: normalizeObjectIdList(raw.resendIntegrationIds, 'resendIntegrationIds'),
    posthogIntegrationIds: normalizeObjectIdList(
      raw.posthogIntegrationIds,
      'posthogIntegrationIds',
    ),
    deviceIds: normalizeStringList(raw.deviceIds, 'deviceIds'),
    // Absent stays absent for these: undefined is "not narrowed" (team-wide),
    // which is not the same grant as an explicit empty list.
    githubInstallationIds: normalizeOptionalStringList(
      raw.githubInstallationIds,
      'githubInstallationIds',
    ),
    gitlabBindingIds: normalizeOptionalObjectIdList(raw.gitlabBindingIds, 'gitlabBindingIds'),
    grafanaInstanceIds: normalizeOptionalObjectIdList(raw.grafanaInstanceIds, 'grafanaInstanceIds'),
    sonarqubeIntegrationIds: normalizeOptionalObjectIdList(
      raw.sonarqubeIntegrationIds,
      'sonarqubeIntegrationIds',
    ),
    notionIntegrationIds: normalizeOptionalObjectIdList(
      raw.notionIntegrationIds,
      'notionIntegrationIds',
    ),
    upstashAccountIds: normalizeOptionalObjectIdList(raw.upstashAccountIds, 'upstashAccountIds'),
    cloudflareAccountIds: normalizeOptionalStringList(
      raw.cloudflareAccountIds,
      'cloudflareAccountIds',
    ),
  }
}

function normalizeOptionalObjectIdList(value: unknown, field: string): string[] | undefined {
  return value == null ? undefined : normalizeObjectIdList(value, field)
}

function normalizeOptionalStringList(value: unknown, field: string): string[] | undefined {
  return value == null ? undefined : normalizeStringList(value, field)
}

function normalizeObjectIdList(value: unknown, field: string): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) {
    throw new AppError(400, 'invalid_request', `${field} must be an array`)
  }
  const ids = new Set<string>()

  for (const item of value) {
    if (typeof item !== 'string' || !/^[a-f0-9]{24}$/i.test(item)) {
      throw new AppError(400, 'invalid_request', `${field} contains an invalid ObjectId`)
    }
    ids.add(item)
  }

  return [...ids]
}

function normalizeStringList(value: unknown, field: string): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) {
    throw new AppError(400, 'invalid_request', `${field} must be an array`)
  }
  const ids = new Set<string>()

  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new AppError(400, 'invalid_request', `${field} contains an invalid id`)
    }
    ids.add(item.trim())
  }

  return [...ids]
}
