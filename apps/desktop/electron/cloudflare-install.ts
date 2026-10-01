import { shell } from 'electron'

import * as atlas from './atlas'

// Shared nuphos:// scheme with github/gitlab — distinct hostname so the
// dispatcher in main.ts routes by it without colliding.
export const CLOUDFLARE_CALLBACK_HOST = 'cloudflare-callback'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

type Pending = {
  teamId: string
  resolve: (result: CloudflareBindResult) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
  // Fallback poller: the nuphos:// deep link can be captured by another app
  // (e.g. an installed production build owns the scheme), so we also watch the
  // backend for the binding the callback creates and resolve from that.
  poll?: NodeJS.Timeout
}

const POLL_INTERVAL_MS = 2500

export type CloudflareBindResult = {
  bindingId: string
  teamId: string
  accountId: string
  accountName: string
}

const pending = new Map<string, Pending>()

export async function startInstall(
  teamId: string,
  scopes?: string[],
): Promise<CloudflareBindResult> {
  const { authorizeUrl, state } = await atlas.startCloudflareOAuth(teamId, scopes)

  return new Promise<CloudflareBindResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const p = pending.get(state)

      if (pending.delete(state)) {
        if (p?.poll) clearInterval(p.poll)
        atlas.cancelCloudflareOAuth(teamId, state).catch(() => {})
        reject(new Error('Cloudflare OAuth timed out — please try again.'))
      }
    }, INSTALL_TIMEOUT_MS)

    // Poll the backend for a result keyed by this exact `state`. This resolves
    // the bind even when the nuphos:// deep link is captured by another app
    // instance, and unlike an account-list diff it works for re-binds (which
    // preserve the binding id) and never false-positives on a pre-existing
    // account. The result endpoint is one-shot server-side.
    const poll = setInterval(() => {
      void atlas
        .pollCloudflareOAuthResult(state)
        .then((res) => {
          if (res.ready && pending.delete(state)) {
            clearTimeout(timeout)
            clearInterval(poll)
            resolve({
              bindingId: res.bindingId,
              teamId,
              accountId: res.accountId,
              accountName: res.accountName ?? '',
            })
          }
        })
        .catch(() => {})
    }, POLL_INTERVAL_MS)

    pending.set(state, { teamId, resolve, reject, timeout, poll })
    shell.openExternal(authorizeUrl).catch((e: unknown) => {
      if (pending.delete(state)) {
        clearTimeout(timeout)
        clearInterval(poll)
        atlas.cancelCloudflareOAuth(teamId, state).catch(() => {})
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

export function cancelAllPending() {
  for (const [state, p] of pending) {
    clearTimeout(p.timeout)
    if (p.poll) clearInterval(p.poll)
    atlas.cancelCloudflareOAuth(p.teamId, state).catch(() => {})
    p.reject(new Error('Cloudflare OAuth cancelled'))
  }
  pending.clear()
}

// Renderer-initiated cancel (dialog dismissed while waiting). Deletes the
// backend pending record right away so a late approval can't create a binding
// the UI never hears about.
export function cancelPending(teamId: string) {
  for (const [state, p] of pending) {
    if (p.teamId !== teamId) continue
    pending.delete(state)
    clearTimeout(p.timeout)
    if (p.poll) clearInterval(p.poll)
    atlas.cancelCloudflareOAuth(teamId, state).catch(() => {})
    p.reject(new Error('Cloudflare OAuth cancelled'))
  }
}

export function isCallbackUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)

    return u.hostname === CLOUDFLARE_CALLBACK_HOST || u.host === CLOUDFLARE_CALLBACK_HOST
  } catch {
    return false
  }
}

export async function handleCallback(rawUrl: string): Promise<void> {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    console.warn('[cloudflare-install] received malformed deep link:', rawUrl)

    return
  }
  if (parsed.hostname !== CLOUDFLARE_CALLBACK_HOST && parsed.host !== CLOUDFLARE_CALLBACK_HOST)
    return

  const state = parsed.searchParams.get('state')

  if (!state) {
    console.warn('[cloudflare-install] callback missing state — ignoring')

    return
  }
  const p = pending.get(state)

  if (!p) {
    console.warn('[cloudflare-install] callback state did not match any pending OAuth — ignoring')

    return
  }
  pending.delete(state)
  clearTimeout(p.timeout)
  if (p.poll) clearInterval(p.poll)

  const error = parsed.searchParams.get('error')

  if (error) {
    const description = parsed.searchParams.get('error_description') || error

    p.reject(new Error(`Cloudflare OAuth failed: ${description}`))

    return
  }

  const bindingId = parsed.searchParams.get('binding_id')
  const teamId = parsed.searchParams.get('team_id') ?? p.teamId
  const accountId = parsed.searchParams.get('account_id') ?? ''
  const accountName = parsed.searchParams.get('account_name') ?? ''

  if (!bindingId) {
    p.reject(new Error('Cloudflare callback missing binding_id'))

    return
  }
  p.resolve({ bindingId, teamId, accountId, accountName })
}
