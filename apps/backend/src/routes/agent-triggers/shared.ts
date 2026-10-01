import { AppError } from '@/lib/errors'
import { resolveVerifiedTeamId } from '@/routes/agent'

import type { TriggerActorContext } from '@/lib/agent/trigger-access'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'

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
  const candidate =
    typeof teamCandidate === 'string' && teamCandidate.trim()
      ? teamCandidate.trim()
      : variables.get('teamId')
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

export function parseSlackDestination(value: unknown): SlackOutboundDestination | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>

  if (candidate.type === 'dm_self') return { type: 'dm_self' }
  if (candidate.type === 'channel' && typeof candidate.channelId === 'string') {
    return { type: 'channel', channelId: candidate.channelId }
  }

  return undefined
}
