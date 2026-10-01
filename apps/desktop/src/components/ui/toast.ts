import { Toast } from '@base-ui/react/toast'

import { decideErrorToast } from '../../api'
import { trackError } from '../../lib/analytics'

import type { ReactNode } from 'react'

/*
 * App-wide toast helper built on Base UI's headless Toast.
 *
 * Project rule: user-facing errors are surfaced through this toast — never as
 * inline UI (e.g. an error box under a button). A single global manager is
 * created here so any code path, including non-component API catch blocks, can
 * raise one via `toast.error(...)`. The matching <ToastProvider> (which renders
 * the toasts) is mounted once at the app root in `src/main.tsx`.
 */
export const toastManager = Toast.createToastManager()

export type ToastType = 'error' | 'success' | 'info'
// Optional single action button rendered in the toast (e.g. "Open in folder"
// after a download). Stored on the toast's custom `data`, rendered by
// ToastProvider.
export type ToastAction = { label: string; onClick: () => void }
export type ToastData = { action?: ToastAction }

function asReportText(node: ReactNode): string | undefined {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)

  return node == null ? undefined : '[non-text content]'
}

// A stable id derived from the toast's text content. Base UI treats `add` with
// an existing id as an in-place update (refreshing the timer) rather than a new
// toast, so identical messages fired in quick succession — e.g. the same
// network error bubbling up from two call sites — collapse into one instead of
// stacking. Only derived when both parts are plain text; non-text content can't
// be compared, so those toasts stack as before.
function dedupeId(type: ToastType, title: ReactNode, description?: ReactNode): string | undefined {
  const t = asReportText(title)
  const d = asReportText(description)

  if (t === undefined || t === '[non-text content]' || d === '[non-text content]') return undefined

  // Structurally encode the tuple so text containing the delimiter can't collide.
  return JSON.stringify([type, t, d ?? ''])
}

function emit(
  type: ToastType,
  title: ReactNode,
  description?: ReactNode,
  action?: ToastAction,
  opts?: { skipReport?: boolean; timeoutMs?: number; dedupe?: boolean },
) {
  // Every error toast is by definition a user-facing failure — report it to
  // PostHog so frontend error rates are queryable without each call site
  // having to remember to instrument itself. apiError's fallback path reports
  // itself (with the raw error) and opts out to avoid double-counting.
  if (type === 'error' && !opts?.skipReport) {
    trackError({
      source: 'toast',
      message: asReportText(title) ?? 'unknown error',
      description: asReportText(description),
    })
  }

  return toastManager.add({
    id: opts?.dedupe === false ? undefined : dedupeId(type, title, description),
    title,
    description,
    type,
    priority: type === 'error' ? 'high' : 'low',
    // Errors stay until dismissed; success/info auto-dismiss. A toast with an
    // action lingers a bit longer so the button is clickable.
    timeout: opts?.timeoutMs ?? (type === 'error' ? 0 : action ? 9000 : 5000),
    ...(action ? { data: { action } satisfies ToastData } : {}),
  })
}

export const toast = {
  error: (title: ReactNode, description?: ReactNode) => emit('error', title, description),
  // Whitelist-gated error toast for a caught API failure. Pass the raw caught
  // value — never a pre-formatted message. Backend-authored business errors
  // (structured code via the atlas sentinel) surface as a normal error toast;
  // everything else stays off-screen: transport/unexpected errors are reported
  // to PostHog as suppressed renderer_error events (phase: 'suppressed') so
  // failure rates stay queryable without spamming the user.
  //
  // `fallback` is for primary user-initiated flows (login, payment) that must
  // never fail silently: on an unexpected/transport error the toast shows this
  // hand-authored description instead of being suppressed. The raw error still
  // goes to PostHog (phase: 'fallback').
  apiError: (title: ReactNode, err: unknown, opts?: { fallback?: string }) => {
    const decision = decideErrorToast(err)

    if (decision.action === 'show') {
      trackError(
        {
          source: 'toast',
          phase: 'api_error',
          message: asReportText(title) ?? 'unknown error',
          description: decision.description,
        },
        err,
      )

      return emit('error', title, decision.description, undefined, { skipReport: true })
    }
    const raw = err instanceof Error ? err.message : String(err)

    if (opts?.fallback !== undefined) {
      trackError(
        {
          source: 'toast',
          phase: 'fallback',
          message: asReportText(title) ?? 'unknown error',
          description: raw,
        },
        err,
      )

      return emit('error', title, opts.fallback, undefined, { skipReport: true })
    }
    console.warn('[toast] suppressed error toast:', asReportText(title), err)
    trackError(
      {
        source: 'toast',
        phase: 'suppressed',
        message: asReportText(title) ?? 'unknown error',
        description: raw,
      },
      err,
    )
  },
  success: (
    title: ReactNode,
    description?: ReactNode,
    opts?: { action?: ToastAction; timeoutMs?: number; dedupe?: boolean },
  ) =>
    emit('success', title, description, opts?.action, {
      timeoutMs: opts?.timeoutMs,
      dedupe: opts?.dedupe,
    }),
  info: (title: ReactNode, description?: ReactNode) => emit('info', title, description),
}

// Dev convenience: trigger toasts straight from the devtools console, e.g.
//   toast.error('Title', 'optional description')
//   toast.success('Saved')
//   toast.info('Heads up')
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { toast: typeof toast }).toast = toast
}
