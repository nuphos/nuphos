// When a live conversation session has to be handed its context again before
// the next prompt, rather than reusing what the runtime already holds.
import type { TeamSession } from './team-openab-runtime'

// Half the conversation token's TTL: a runtime that ignores per-prompt context
// still gets a fresh credential through session/resume before the old one expires.
export const SESSION_CONTEXT_REFRESH_MS = 12 * 60 * 60 * 1000

export function sessionContextStale(
  session: Pick<TeamSession, 'contextDeliveredAt'>,
  now: number,
): boolean {
  return now - (session.contextDeliveredAt ?? 0) >= SESSION_CONTEXT_REFRESH_MS
}

// The principal is the actor and which HOME they run in: the same member's own
// turn and an automated one differ in credentials, so they reload too.
export function previewSessionPrincipalChanged(
  session: Pick<TeamSession, 'userId' | 'runtime'>,
  nextUserId: string,
  nextRuntime?: Pick<NonNullable<TeamSession['runtime']>, 'env'>,
): boolean {
  return (
    session.userId !== nextUserId ||
    (nextRuntime !== undefined &&
      session.runtime?.env?.NUPHOS_SESSION_ACTOR !== nextRuntime.env?.NUPHOS_SESSION_ACTOR)
  )
}
