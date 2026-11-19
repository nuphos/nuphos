import { config } from '@/config'
import { stripTrailingSlashes } from '@/lib/agent/text-scan'
import { AppError } from '@/lib/errors'
import { resolveVerifiedTeamId } from '@/routes/agent'

import type { TriggerActorContext } from '@/lib/agent/trigger-access'

/**
 * The actor every trigger service call is authorized against. Mutating
 * services assert the required team role themselves, so these routes only
 * resolve identity — the one exception is the list endpoints, which have no
 * per-resource service check to hang read access on.
 *
 * A team id that was asked for but does not resolve is an error, not a reason
 * to fall back to personal scope: silently downgrading would answer a team
 * request with personal data, and would have `POST /` quietly create a
 * personal Trigger where a team one was intended.
 */
export async function triggerActor(
  c: Parameters<typeof resolveVerifiedTeamId>[0] & { get(key: 'userId'): string },
  teamCandidate: unknown,
): Promise<TriggerActorContext> {
  const userId = c.get('userId')
  const variables = c as unknown as {
    get(key: 'teamId'): string | undefined
    get(key: 'conversationAgent'): { sessionId: string } | undefined
  }
  const requested =
    typeof teamCandidate === 'string' && teamCandidate.trim() ? teamCandidate.trim() : undefined
  // Under /teams/:teamId the path team is the one the caller was authorized
  // for; a different body or query team must not replace it.
  const pathTeamId = variables.get('teamId')

  if (pathTeamId && requested && requested !== pathTeamId) {
    throw new AppError(403, 'team_out_of_scope', 'teamId does not match the team in the path')
  }
  const candidate = pathTeamId ?? requested
  const conversationAgent = variables.get('conversationAgent')

  if (!candidate) {
    return { userId, ...(conversationAgent ? { sessionId: conversationAgent.sessionId } : {}) }
  }
  const teamId = await resolveVerifiedTeamId(c, candidate)

  if (!teamId) {
    throw new AppError(404, 'team_not_found', 'Team not found')
  }

  return {
    userId,
    teamId,
    ...(conversationAgent ? { sessionId: conversationAgent.sessionId } : {}),
  }
}

/**
 * A request body as a plain object. `c.req.json<T>()` is only a TypeScript
 * assertion, so a JSON `null`, array, or scalar would sail through and blow up
 * on the first property read — a 500 where the client deserves a 400.
 */
export async function jsonObjectBody(c: {
  req: { json(): Promise<unknown> }
}): Promise<Record<string, unknown>> {
  let parsed: unknown

  try {
    parsed = await c.req.json()
  } catch {
    throw new AppError(400, 'invalid_request', 'Body must be valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError(400, 'invalid_request', 'Body must be a JSON object')
  }

  return parsed as Record<string, unknown>
}

export function webhookUrlFor(triggerId: string | undefined): string | undefined {
  if (!triggerId) return undefined
  // Prefer the public origin: NUPHOS_BACKEND_URL is the cluster-INTERNAL base
  // in production (it exists so sandboxes can call the backend), which external
  // webhook senders can't reach. auth.publicBaseUrl is the deploy's public
  // origin — but skip its localhost fallback (local dev with no
  // NUPHOS_AUTH_BASE_URL), where backendUrl (e.g. a dev tunnel) is the
  // reachable one.
  const publicBase = config.auth.publicBaseUrl
  const raw =
    publicBase && !/\/\/localhost[:/]/i.test(publicBase) ? publicBase : config.agent.backendUrl
  const base = raw ? stripTrailingSlashes(raw) : undefined

  return base ? `${base}/webhooks/${triggerId}` : `/webhooks/${triggerId}`
}
