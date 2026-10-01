// Renderer-side PostHog wrapper. Initializes posthog-js with autocapture +
// masked session replay, and exposes typed helpers for identify/reset, custom
// events, and pageviews. All calls are safe no-ops until init() runs and finds
// a key, so callers never need to null-check.
import posthog from 'posthog-js'

import { setFrontendErrorReporter } from './frontendErrorReporter'
import { sanitizeReportText } from './reportRedaction'

import type { UserInfo } from '../types'

// phc_ project keys are write-only ingest keys designed to ship inside client
// apps (they're visible in any web app's network tab), so embedding a default
// here is safe and guarantees telemetry works even if the build-time env var
// is missing. Override per-build via VITE_POSTHOG_KEY.
//
// The default only applies to production builds: dev servers were polluting
// the production PostHog project with localhost autocapture/pageviews
// (NUPS-646). Set VITE_POSTHOG_KEY explicitly to test telemetry in dev.
const DEFAULT_KEY = 'phc_tD7X8fho5ug5BcC6zTZRWDn7wKFqGk3t3Y5bVE9Z67a9'
const KEY =
  (import.meta.env.VITE_POSTHOG_KEY as string | undefined) ||
  (import.meta.env.PROD ? DEFAULT_KEY : undefined)
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com'

let started = false

/** Closed event-name union so call sites stay consistent and greppable. */
export type AnalyticsEvent =
  | 'app_ready'
  | 'login'
  | 'logout'
  | 'team_switched'
  | 'navigation'
  | 'tab_opened'
  | 'tab_closed'
  | 'agent_chat_started'
  | 'agent_client_tool_deadline_exceeded'
  | 'agent_message_sent'
  | 'agent_message_queued'
  | 'agent_message_feedback'
  | 'agent_response_stopped'
  // Stop was clicked but the backend did not confirm the run ended.
  | 'agent_response_stop_failed'
  | 'agent_tool_call_incomplete'
  // Agent stream lifecycle. Deliberately fine-grained: every one of these marks
  // a point where a turn can stop making progress, and the whole point is that
  // the next hang is reconstructable from PostHog alone.
  | 'agent_client_tool_phase_entered'
  | 'agent_client_tool_phase_stalled'
  | 'agent_stream_end_decided'
  | 'agent_resume_dispatched'
  | 'agent_end_effects_deferred'
  | 'agent_end_effects_drained'
  | 'agent_plan_approved'
  | 'agent_plan_rejected'
  | 'agent_plan_changes_requested'
  // Trust depth. The decision is a GRADIENT (once < session < always), not a
  // boolean approve/reject: how far the user is willing to let the agent run
  // unattended is the signal, and it stays readable without knowing how wide
  // the team's underlying cloud permissions actually are. Raw decisions on
  // purpose — the ratio to compute from them is a question for the dashboard,
  // and a decision not recorded now cannot be reconstructed later.
  | 'agent_authorization_decided'
  // The conversation-level counterpart: bypass hands over confirmation
  // standingly rather than per tool call. Sent only once the server accepted
  // the switch, so a reverted toggle never reads as a decision.
  | 'agent_permission_mode_changed'
  | 'agent_conversation_deleted'
  | 'agent_memories_opened'
  | 'agent_first_run_home_viewed'
  | 'agent_first_run_connect_started'
  | 'agent_first_run_strip_dismissed'
  // The guide's funnel. The gap between cloud_picked and operational_bound is
  // the console trip — the only step we can't shorten from here. asked and
  // answered mark the first real conversation; the gap between answered and
  // wall_setup_started is how long the savings stage takes to sell the second
  // role, and its absence is people who stopped at read-only.
  | 'agent_first_run_cloud_picked'
  // The scenario screen sits between the pick and the console steps, so these
  // two are separate funnel points: picked a cloud, then chose to go through
  // with its setup after reading what it buys them.
  | 'agent_first_run_setup_started'
  | 'agent_first_run_operational_bound'
  | 'agent_first_run_question_asked'
  | 'agent_first_run_answer_received'
  | 'pod_deleted'
  | 'deployment_restarted'
  | 'node_cordoned'
  | 'port_forward_started'
  | 'port_forward_stopped'
  | 'ssh_terminal_opened'
  | 'cluster_selected'
  | 'resource_yaml_viewed'
  | 'pod_logs_viewed'
  | 'link_copied'
  | 'theme_changed'
  | 'file_selected'
  | 'update_install_clicked'
  | 'renderer_error'

type Props = Record<string, unknown>

// The team the active tab is scoped to. Attribution is per *event*, not per
// person: a user can belong to several teams and switch between them mid
// session, so team_id has to be stamped when the event fires rather than set
// once on the person profile. Kept in sync by setActiveTeam().
let activeTeamId: string | null = null

// Merged at capture time (not at the ~100 track() call sites) so no event can
// ship without team attribution. Matches how the backend merges team_id inside
// its own capture() (apps/backend/src/lib/posthog.ts). Explicit props win, so a
// call site that knows a more specific team can still override.
function withTeam(props?: Props): Props | undefined {
  if (!activeTeamId) return props

  return { team_id: activeTeamId, ...props }
}

// Same shape as mirrorIdentityToMain below: `async` so a synchronous bridge
// throw (dev:web has no IPC bridge) surfaces as a rejection the caller's single
// `.catch` handles alongside IPC rejections.
async function mirrorTeamToMain(teamId: string | null): Promise<void> {
  await window.api?.analyticsSetTeam?.(teamId)
}

/**
 * Point analytics at the team the user is currently working in, and mirror it
 * to the Electron main process so its privileged-operation events (pod delete,
 * deployment restart, …) attribute to the same team. Pass null when there is no
 * team scope (login, onboarding, logout).
 */
export function setActiveTeam(teamId: string | null): void {
  const next = teamId && teamId.length > 0 ? teamId : null

  if (next === activeTeamId) return
  activeTeamId = next
  mirrorTeamToMain(next).catch(() => undefined)
}

export function initAnalytics(): void {
  if (started || !KEY) return
  started = true
  setFrontendErrorReporter(trackError)
  posthog.init(KEY, {
    api_host: HOST,
    autocapture: true,
    // Custom tab/scope navigation isn't URL-driven, so we emit pageviews
    // manually via trackPageview() instead of letting posthog guess from
    // history changes.
    capture_pageview: false,
    capture_pageleave: true,
    // This tool renders secrets, tokens, env vars, and pod logs. Record with
    // heavy masking: every input is masked, plus any element tagged sensitive
    // (logs/code/secret values) has its text scrubbed from the replay.
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-ph-mask], .secret, .token, .sensitive, pre, code',
    },
    persistence: 'localStorage',
    // Prevent PostHog from fetching/injecting any out-of-bundle scripts
    // (surveys, toolbar) into the renderer at runtime — those would execute
    // with full Electron process privileges.
    disable_external_dependency_loading: true,
  })
}

// Mirror the identity to the Electron main process so its lifecycle/crash
// events attribute to the same person. `async` so a synchronous bridge throw
// (dev:web has no IPC bridge) surfaces as a rejection the caller's single
// `.catch` handles alongside IPC rejections.
async function mirrorIdentityToMain(user: UserInfo): Promise<void> {
  await window.api?.analyticsIdentify?.(user.id, {
    email: user.email,
    name: user.name,
    username: user.username,
  })
}

export function identifyUser(user: UserInfo): void {
  if (started) {
    posthog.identify(user.id, {
      email: user.email,
      name: user.name,
      username: user.username,
      language: user.language,
    })
  }
  mirrorIdentityToMain(user).catch(() => undefined)
}

export function resetAnalytics(): void {
  // Unconditional: the next user may not be in this team, so the scope must
  // drop even when posthog itself never started (no key configured).
  setActiveTeam(null)
  if (!started) return
  posthog.reset()
}

export function track(event: AnalyticsEvent, props?: Props): void {
  if (!started) return
  posthog.capture(event, withTeam(props))
}

export type RendererErrorReport = {
  /** Which surface raised it: 'agent_stream', 'toast', 'agent_start', … */
  source: string
  /** Machine-readable failure phase, e.g. 'renderer_auto_resume_exhausted'. */
  phase?: string
  message: string
} & Props

// Identical (source, phase, message, description) reports within this window
// are dropped: React Strict Mode runs state updaters twice in dev, error
// toasts can be re-raised by retry loops, and a single broken stream can hit
// several error paths at once. PostHog needs one event per incident, not one
// per render.
const ERROR_REPORT_THROTTLE_MS = 5_000
const recentErrorReports = new Map<string, number>()

/**
 * Central funnel for every user-facing frontend error. All surfaces that show
 * an error to the user (toast.error, agent chat tab errors, stream failures)
 * report through here. Keep the `renderer_error` product event for existing
 * failure-rate insights, and also capture a real PostHog exception so the same
 * incident appears in Error Tracking. Throws never escape; reporting must not
 * break the surface that is already handling a failure.
 */
export function trackError(report: RendererErrorReport, cause?: unknown): void {
  if (!started) return
  try {
    const message = sanitizeReportText(report.message) ?? 'unknown error'
    const description = sanitizeReportText(report.description)
    const causeType = cause instanceof Error ? sanitizeReportText(cause.name) : undefined
    const safeReport: RendererErrorReport = {
      ...report,
      message,
      description,
      cause_type: causeType,
    }
    const key = `${safeReport.source}:${safeReport.phase ?? ''}:${message}:${description ?? ''}`
    const now = Date.now()
    const last = recentErrorReports.get(key)

    if (last !== undefined && now - last < ERROR_REPORT_THROTTLE_MS) return
    if (recentErrorReports.size > 200) {
      for (const [k, t] of recentErrorReports) {
        if (now - t > ERROR_REPORT_THROTTLE_MS) recentErrorReports.delete(k)
      }
    }
    recentErrorReports.set(key, now)
    posthog.capture('renderer_error', withTeam(safeReport))
    const exception = new Error(description ? `${message}: ${description}` : message)

    exception.name = 'RendererError'
    // Remove this telemetry helper from the top of V8 stacks. The next frame
    // is the product surface that reported the incident, which is what makes
    // the Error Tracking issue useful once source maps are available.
    ;(
      Error as ErrorConstructor & {
        captureStackTrace?: (target: object, constructor?: (...args: never[]) => unknown) => void
      }
    ).captureStackTrace?.(exception, trackError)
    posthog.captureException(
      exception,
      withTeam({
        ...safeReport,
        // Product-state failures often have no thrown JS Error (for example an
        // SSE error frame). Group those by their stable surface/phase instead
        // of a backend message that can contain request-specific details.
        $exception_fingerprint: `renderer:${safeReport.source}:${safeReport.phase ?? message}`,
        renderer_error_event: 'renderer_error',
      }),
    )
  } catch {
    // Never let telemetry break an error path.
  }
}

export function trackPageview(location: { pathname: string; href: string }, props?: Props): void {
  if (!started) return
  posthog.capture(
    '$pageview',
    withTeam({
      $current_url: location.href,
      pathname: location.pathname,
      ...props,
    }),
  )
}

export function captureRendererException(error: unknown, props?: Props): string | null {
  if (!started) return null

  return posthog.captureException(error, withTeam(props))?.uuid ?? null
}
