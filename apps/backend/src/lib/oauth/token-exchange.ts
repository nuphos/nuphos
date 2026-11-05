// RFC 8693 token exchange: turns a conversation token into a narrower,
// shorter-lived one. The result never reaches further than its subject: same
// conversation and team, a subset of the credentials the subject may vend, and
// an expiry no later than the subject's. No refresh token is issued, and every
// exchange is rate limited and logged.
import { verifyAgentForActor } from '@/lib/agents/identity'
import { CREDENTIAL_LISTERS } from '@/lib/claude-code-preview/credential-listing'
import { mintPreviewMcpToken, verifyPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { logEvent } from '@/lib/observability'
import { redisEnabled, withRedis } from '@/lib/redis'
import { getAgentCredentialOptions } from '@/routes/agent/credential-options'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { AgentRef } from '@/lib/agents/identity'
import type { SelectionKey } from '@/lib/claude-code-preview/credential-lister'
import type { TokenActor } from '@/lib/claude-code-preview/mcp-token'

export const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'
export const JWT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt'
const SUBJECT_TOKEN_TYPES = new Set([
  JWT_TOKEN_TYPE,
  'urn:ietf:params:oauth:token-type:access_token',
])
const CONVERSATION_AUDIENCE = 'nuphos-preview-mcp'

/** Exchanged tokens live at most this long, and never past their subject. */
export const EXCHANGED_TOKEN_MAX_TTL_SEC = 30 * 60
const MIN_TTL_SEC = 60

const RESOURCE = /^credential:([\w-]{1,64})\/([^\s/]{1,256})$/u
const ACTOR = /^(?:desktop|cli|session|runtime):[\w.:-]{1,128}$/u

const SUBJECT_LIMIT = 60
const TEAM_LIMIT = 600
const WINDOW_SECONDS = 60
const CONSUME_QUOTA_SCRIPT = `
local subject_count = tonumber(redis.call('GET', KEYS[1]) or '0')
local team_count = tonumber(redis.call('GET', KEYS[2]) or '0')

if subject_count >= tonumber(ARGV[1]) or team_count >= tonumber(ARGV[2]) then
  return 0
end

if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], ARGV[3]) end

return 1
`

export type TokenExchangeRequest = {
  subjectToken: string
  subjectTokenType: string
  /** `credential:<provider>/<id>`, as the subject's list_credentials names them. */
  resources: string[]
  audience?: string
  teamId?: string
  expiresIn?: string
  actor?: string
}

export type TokenExchangeResult =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; status: 400 | 429 | 503; error: string; description: string }

const fail = (
  error: string,
  description: string,
  status: 400 | 429 | 503 = 400,
): TokenExchangeResult => ({ ok: false, status, error, description })

async function consumeQuota(
  subject: string,
  teamId: string,
): Promise<'allowed' | 'limited' | 'unavailable'> {
  if (!redisEnabled()) return 'allowed'
  const result = await withRedis((client) =>
    client.eval(
      CONSUME_QUOTA_SCRIPT,
      2,
      `token-exchange:subject:${subject}`,
      `token-exchange:team:${teamId}`,
      SUBJECT_LIMIT,
      TEAM_LIMIT,
      WINDOW_SECONDS,
    ),
  )

  if (result === 1) return 'allowed'

  // A shared quota is the only bound on minting, so a Redis failure fails closed.
  return result === 0 ? 'limited' : 'unavailable'
}

type Ttl = { ttl: number; error?: undefined } | { ttl?: undefined; error: string }

function parseTtl(raw: string | undefined, remaining: number): Ttl {
  const ceiling = Math.min(EXCHANGED_TOKEN_MAX_TTL_SEC, remaining)

  if (raw === undefined || raw === '') return { ttl: ceiling }
  if (!/^\d{1,6}$/u.test(raw)) return { error: 'expires_in must be a whole number of seconds' }
  const ttl = Number(raw)

  if (ttl < MIN_TTL_SEC)
    return { error: `expires_in must be at least ${String(MIN_TTL_SEC)} seconds` }
  if (ttl > EXCHANGED_TOKEN_MAX_TTL_SEC) {
    return { error: `expires_in may not exceed ${String(EXCHANGED_TOKEN_MAX_TTL_SEC)} seconds` }
  }
  if (ttl > remaining) return { error: 'expires_in may not outlive the subject token' }

  return { ttl }
}

type Ref = { provider: string; id: string }

/**
 * Selection fields a limited token cannot use: they are reached only through
 * native tools (devices, on-prem kubeconfigs) or unscoped team routes
 * (compliance test proxies), all of which refuse limited tokens.
 */
const UNDELEGABLE = new Set<SelectionKey>([
  'deviceIds',
  'onpremClusterIds',
  'vantaIntegrationIds',
  'secureframeIntegrationIds',
])

/**
 * The credential limit for `resources`, each one the subject may vend now, as
 * its list_credentials shows it. Returns the refs it could not match instead.
 */
async function limitFor(
  agent: AgentRef,
  teamId: string,
  refs: Ref[],
): Promise<{ limit: Record<string, string[]> } | { missing: Ref[] } | { undelegable: Ref[] }> {
  const [access, options] = await Promise.all([
    getAgentCredentialAccess(agent, teamId),
    getAgentCredentialOptions(teamId, agent.userId),
  ])
  const limit: Record<string, string[]> = {}
  const undelegable: Ref[] = []
  let pending = refs

  for (const key of Object.keys(CREDENTIAL_LISTERS) as SelectionKey[]) {
    const selected = CREDENTIAL_LISTERS[key](access[key], options).selected
    const matches = (ref: Ref) =>
      selected.some((entry) => entry.provider === ref.provider && entry.id === ref.id)

    const matched = pending.filter(matches)

    if (UNDELEGABLE.has(key)) undelegable.push(...matched)
    limit[key] = [...new Set(matched.map((ref) => ref.id))]
    pending = pending.filter((ref) => !matches(ref))
  }
  if (pending.length) return { missing: pending }

  return undelegable.length ? { undelegable } : { limit }
}

export async function exchangeConversationToken(
  request: TokenExchangeRequest,
): Promise<TokenExchangeResult> {
  if (!request.subjectToken || !request.subjectTokenType) {
    return fail('invalid_request', 'Missing subject_token or subject_token_type')
  }
  if (!SUBJECT_TOKEN_TYPES.has(request.subjectTokenType)) {
    return fail('invalid_request', 'subject_token_type must be a JWT access token')
  }
  if (request.audience && request.audience !== CONVERSATION_AUDIENCE) {
    return fail('invalid_target', `audience must be ${CONVERSATION_AUDIENCE}`)
  }
  if (request.actor !== undefined && !ACTOR.test(request.actor)) {
    return fail(
      'invalid_request',
      'actor must look like desktop:<id>, cli:<id>, session:<id> or runtime:<id>',
    )
  }
  const claims = verifyPreviewMcpToken(request.subjectToken)

  if (!claims) return fail('invalid_grant', 'subject_token is not a valid conversation token')
  if (request.teamId && request.teamId !== claims.tid) {
    return fail('invalid_target', 'The subject token is not valid for this team')
  }
  const refs: Ref[] = []

  for (const resource of request.resources) {
    const match = RESOURCE.exec(resource)

    if (!match?.[1] || !match[2]) {
      return fail('invalid_target', `resource must be credential:<provider>/<id>, got ${resource}`)
    }
    refs.push({ provider: match[1], id: match[2] })
  }
  const now = Math.floor(Date.now() / 1000)
  const parsed = parseTtl(request.expiresIn, claims.exp - now)

  if (parsed.error !== undefined) return fail('invalid_request', parsed.error)
  const { ttl } = parsed
  const quota = await consumeQuota(claims.jti ?? claims.sid, claims.tid)

  if (quota === 'limited') return fail('rate_limited', 'Too many token exchanges; retry later', 429)
  if (quota === 'unavailable') {
    return fail('temporarily_unavailable', 'Token exchange is unavailable; retry later', 503)
  }
  const ref = await verifyAgentForActor(claims.sub, claims.own, claims.sid)

  if (!ref) return fail('invalid_grant', 'The subject token’s conversation is no longer available')
  const agent: AgentRef = claims.lim ? { ...ref, credentialLimit: claims.lim } : ref
  const narrowed = refs.length ? await limitFor(agent, claims.tid, refs) : null

  const named = (list: Ref[]) =>
    list.map(({ provider, id }) => `credential:${provider}/${id}`).join(', ')

  if (narrowed && 'missing' in narrowed) {
    return fail('invalid_target', `Not available to the subject token: ${named(narrowed.missing)}`)
  }
  if (narrowed && 'undelegable' in narrowed) {
    return fail(
      'invalid_target',
      `Cannot be delegated to a limited token: ${named(narrowed.undelegable)}. Exchange without resource to keep the subject's access.`,
    )
  }
  const actor: TokenActor = {
    sub: request.actor ?? `session:${claims.sid}`,
    ...(claims.act ? { act: claims.act } : {}),
  }
  const resources = [...new Set(request.resources)]
  const accessToken = await mintPreviewMcpToken({
    userId: claims.sub,
    conversationOwnerUserId: claims.own,
    sessionId: claims.sid,
    teamId: claims.tid,
    apiOrigin: claims.ori,
    humanTurn: claims.hum,
    ttlSec: ttl,
    expiresAt: claims.exp,
    actor,
    // Without resources the result keeps the subject's own limit, if any.
    ...(narrowed ? { credentialLimit: narrowed.limit, resources } : {}),
    ...(!narrowed && claims.lim ? { credentialLimit: claims.lim } : {}),
  })

  logEvent('info', 'auth.token_exchange', {
    jti: verifyPreviewMcpToken(accessToken)?.jti,
    subject_jti: claims.jti,
    session_id: claims.sid,
    team_id: claims.tid,
    subject: claims.sub,
    actor: actor.sub,
    resources: narrowed ? resources : undefined,
    expires_in: ttl,
  })

  return { ok: true, accessToken, expiresIn: ttl }
}
