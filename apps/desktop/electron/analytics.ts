// Main-process PostHog (posthog-node). Captures app-lifecycle, auto-update,
// deep-link, and crash events, plus the outcome of privileged IPC operations
// (pod delete, deployment restart, …) where the main process — not the
// renderer — knows whether the action actually succeeded.
//
// The distinctId is unified with the renderer: the renderer calls
// analytics:identify after posthog-js identify(), so both sides attribute to
// the same person. Until then events use an anonymous device id.
//
// Team attribution rides the same channel: the renderer calls
// analytics:setTeam whenever the active tab's team changes, and every event
// captured from here carries that team_id. Attribution is per *event*, not per
// person — one user can belong to several teams, so a static person→team
// mapping would misattribute every operation done outside their "main" team.
import { randomUUID } from 'node:crypto'

import { PostHog } from 'posthog-node'

import { isDev } from './main/env.ts'

// phc_ project keys are public ingest keys (safe to embed in a shipped app).
// Override per-build via POSTHOG_KEY.
//
// Like the renderer, the default key only applies outside dev so local runs
// don't send app_launched/crash events to the production PostHog project
// (NUPS-646). Set POSTHOG_KEY explicitly to test telemetry in dev.
const DEFAULT_KEY = 'phc_tD7X8fho5ug5BcC6zTZRWDn7wKFqGk3t3Y5bVE9Z67a9'
const KEY = process.env.POSTHOG_KEY || (isDev ? undefined : DEFAULT_KEY)
const HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com'

let client: PostHog | null = null
// Per-instance anonymous id so pre-login events (app_launched, updater, deep
// links, crashes) don't all collapse onto one shared person; on login we
// alias() it onto the real user so those pre-login events merge into the
// user's profile (posthog-node needs an explicit alias; identify alone won't
// stitch the anonymous distinctId).
// Mutable so logout can rotate to a fresh anonymous identity (see
// resetAnonymousIdentity) — otherwise post-logout events would stay attributed
// to the just-aliased user, and the next user wouldn't get stitched.
let anonymousDistinctId: string = randomUUID()
let distinctId: string = anonymousDistinctId
let aliased = false
// The team the renderer is currently scoped to. Null before the workspace has
// a team (login screen, onboarding, no-team shell) and after logout.
let activeTeamId: string | null = null

function resetAnonymousIdentity(): void {
  anonymousDistinctId = randomUUID()
  distinctId = anonymousDistinctId
  aliased = false
}

export function initMainAnalytics(): void {
  if (client || !KEY) return
  client = new PostHog(KEY, {
    host: HOST,
    flushAt: 1,
    flushInterval: 5_000,
    disableGeoip: false,
  })
}

/** Bind subsequent main-process events to the logged-in user (called via IPC
 *  from the renderer after posthog-js identify). */
export function setAnalyticsUser(userId: string, properties?: Record<string, unknown>): void {
  if (!userId) return
  try {
    // Stitch this instance's pre-login anonymous events onto the real user,
    // once, before we switch the active distinctId.
    if (!aliased) {
      client?.alias({ distinctId: userId, alias: anonymousDistinctId })
      aliased = true
    }
    client?.identify({ distinctId: userId, properties })
  } catch {
    // never let telemetry throw into the main process
  }
  distinctId = userId
}

/** Bind subsequent main-process events to the team the renderer is scoped to
 *  (called via IPC whenever the active tab's team changes). */
export function setAnalyticsTeam(teamId: string | null): void {
  activeTeamId = teamId && teamId.length > 0 ? teamId : null
}

/** The team an operation is *starting* under. Callers that emit their event
 *  after an await must snapshot this first — see withCapture. */
export function currentAnalyticsTeam(): string | null {
  return activeTeamId
}

export function resetAnalyticsUser(): void {
  // Fresh anonymous identity per session so the previous user's alias doesn't
  // capture post-logout events and the next login can stitch again.
  resetAnonymousIdentity()
  // The next user may not be in this team at all — never carry it across.
  activeTeamId = null
}

// Event-time team stamping happens here rather than at the ~10 withCapture call
// sites so no event can be added without it, mirroring how the backend merges
// team_id inside its own capture() (apps/backend/src/lib/posthog.ts). Explicit
// props win, so a call site that knows a more specific team can override.
function withTeam(properties?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!activeTeamId) return properties

  return { team_id: activeTeamId, ...properties }
}

export function captureMain(event: string, properties?: Record<string, unknown>): void {
  try {
    client?.capture({ distinctId, event, properties: withTeam(properties) })
  } catch {
    // ignore
  }
}

export function captureMainException(error: unknown, properties?: Record<string, unknown>): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error))

    client?.captureException(err, distinctId, withTeam(properties))
  } catch {
    // ignore
  }
}

export async function shutdownMainAnalytics(): Promise<void> {
  try {
    await client?.shutdown(2_000)
  } catch {
    // ignore
  } finally {
    client = null
  }
}
