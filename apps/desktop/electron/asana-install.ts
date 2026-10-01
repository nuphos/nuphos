import { shell } from 'electron'

import * as atlas from './atlas'

// Shared scheme with jira-install / linear-install — asana uses a distinct
// hostname (nuphos://asana-callback) so the dispatcher in main.ts can route by
// it without colliding.
export const ASANA_CALLBACK_HOST = 'asana-callback'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

type Pending = {
  teamId: string
  resolve: (result: AsanaBindResult) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

export type AsanaBindResult = {
  bindingId: string
  teamId: string
  accountName: string
}

const pending = new Map<string, Pending>()

export async function startInstall(teamId: string): Promise<AsanaBindResult> {
  const { authorizeUrl, state } = await atlas.startAsanaOAuth(teamId)

  return new Promise<AsanaBindResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.delete(state)) {
        atlas.cancelAsanaOAuth(teamId, state).catch(() => {})
        reject(new Error('Asana OAuth timed out — please try again.'))
      }
    }, INSTALL_TIMEOUT_MS)

    pending.set(state, { teamId, resolve, reject, timeout })
    shell.openExternal(authorizeUrl).catch((e: unknown) => {
      if (pending.delete(state)) {
        clearTimeout(timeout)
        atlas.cancelAsanaOAuth(teamId, state).catch(() => {})
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

export function cancelAllPending() {
  for (const [state, p] of pending) {
    clearTimeout(p.timeout)
    atlas.cancelAsanaOAuth(p.teamId, state).catch(() => {})
    p.reject(new Error('Asana OAuth cancelled'))
  }
  pending.clear()
}

// Renderer-initiated cancel (dialog dismissed while waiting). Deleting the
// backend pending record right away — instead of waiting for the 10-minute
// timeout — also invalidates the authorize URL still open in the browser, so a
// late approval can't create a binding the UI never hears about.
export function cancelPending(teamId: string) {
  for (const [state, p] of pending) {
    if (p.teamId !== teamId) continue
    pending.delete(state)
    clearTimeout(p.timeout)
    atlas.cancelAsanaOAuth(teamId, state).catch(() => {})
    p.reject(new Error('Asana OAuth cancelled'))
  }
}

export function isCallbackUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)

    return u.hostname === ASANA_CALLBACK_HOST || u.host === ASANA_CALLBACK_HOST
  } catch {
    return false
  }
}

export async function handleCallback(rawUrl: string): Promise<void> {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    console.warn('[asana-install] received malformed deep link:', rawUrl)

    return
  }
  if (parsed.hostname !== ASANA_CALLBACK_HOST && parsed.host !== ASANA_CALLBACK_HOST) return

  const state = parsed.searchParams.get('state')

  if (!state) {
    console.warn('[asana-install] callback missing state — ignoring')

    return
  }
  const p = pending.get(state)

  if (!p) {
    console.warn('[asana-install] callback state did not match any pending OAuth — ignoring')

    return
  }
  pending.delete(state)
  clearTimeout(p.timeout)

  const error = parsed.searchParams.get('error')

  if (error) {
    const description = parsed.searchParams.get('error_description') || error

    p.reject(new Error(`Asana OAuth failed: ${description}`))

    return
  }

  const bindingId = parsed.searchParams.get('binding_id')
  const teamId = parsed.searchParams.get('team_id') ?? p.teamId
  const accountName = parsed.searchParams.get('account_name') ?? ''

  if (!bindingId) {
    p.reject(new Error('Asana callback missing binding_id'))

    return
  }
  p.resolve({ bindingId, teamId, accountName })
}
