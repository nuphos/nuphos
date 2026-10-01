import { shell } from 'electron'

import * as atlas from './atlas'

export const POSTHOG_CALLBACK_HOST = 'posthog-callback'
const FALLBACK_TIMEOUT_MS = 10 * 60 * 1000

export const POSTHOG_TIMEOUT_ERROR = 'authorization_timeout'

function msUntil(expiresAt: string): number {
  const deadline = Date.parse(expiresAt)

  return Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : FALLBACK_TIMEOUT_MS
}

export type PosthogOAuthResult =
  | { ok: true; bindingId: string; teamId: string; accountName: string }
  | { ok: false; error: string; description: string }

type Pending = {
  teamId: string
  resolve: (result: PosthogOAuthResult) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

const pending = new Map<string, Pending>()

function drop(state: string, p: Pending, reason: string) {
  pending.delete(state)
  clearTimeout(p.timeout)
  atlas.cancelPosthogOAuth(p.teamId, state).catch(() => {})
  p.reject(new Error(reason))
}

export async function startInstall(
  teamId: string,
  input: atlas.PosthogOAuthInput,
): Promise<PosthogOAuthResult> {
  const { authorizeUrl, state, expiresAt } = await atlas.startPosthogOAuth(teamId, input)

  return new Promise<PosthogOAuthResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!pending.delete(state)) return
      atlas.cancelPosthogOAuth(teamId, state).catch(() => {})
      resolve({
        ok: false,
        error: POSTHOG_TIMEOUT_ERROR,
        description: 'PostHog authorization timed out, nothing was changed; try again.',
      })
    }, msUntil(expiresAt))

    pending.set(state, { teamId, resolve, reject, timeout })
    shell.openExternal(authorizeUrl).catch(() => {
      const p = pending.get(state)

      if (p) drop(state, p, 'Could not open the PostHog authorization page.')
    })
  })
}

export function cancelAllPending() {
  for (const [state, p] of pending) drop(state, p, 'PostHog authorization cancelled')
}

export function cancelPending(teamId: string) {
  for (const [state, p] of pending) {
    if (p.teamId === teamId) drop(state, p, 'PostHog authorization cancelled')
  }
}

function callbackUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl)

    return url.hostname === POSTHOG_CALLBACK_HOST || url.host === POSTHOG_CALLBACK_HOST ? url : null
  } catch {
    return null
  }
}

export function isCallbackUrl(rawUrl: string): boolean {
  return callbackUrl(rawUrl) !== null
}

export function handleCallback(rawUrl: string): void {
  const parsed = callbackUrl(rawUrl)
  const state = parsed?.searchParams.get('state')
  const p = state ? pending.get(state) : undefined

  if (!parsed || !state || !p) {
    console.warn('[posthog-install] callback did not match any pending authorization — ignoring')

    return
  }
  pending.delete(state)
  clearTimeout(p.timeout)

  const error = parsed.searchParams.get('error')

  if (error) {
    p.resolve({
      ok: false,
      error,
      description: parsed.searchParams.get('error_description') ?? error,
    })

    return
  }

  const bindingId = parsed.searchParams.get('binding_id')

  if (!bindingId) {
    p.reject(new Error('PostHog callback missing binding_id'))

    return
  }
  p.resolve({
    ok: true,
    bindingId,
    teamId: parsed.searchParams.get('team_id') ?? p.teamId,
    accountName: parsed.searchParams.get('account_name') ?? '',
  })
}
