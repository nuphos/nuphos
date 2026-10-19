import { shell } from 'electron'

import * as atlas from './atlas'
import { connectorCallbackParams } from './connector-oauth-callback'

// Shared scheme with the other connector installs — plaud uses a distinct
// hostname (nuphos://plaud-callback) so the dispatcher in main.ts can route by
// it without colliding.
export const PLAUD_CALLBACK_HOST = 'plaud-callback'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

type Pending = {
  teamId: string
  resolve: (result: PlaudBindResult) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

export type PlaudBindResult = {
  bindingId: string
  teamId: string
  accountName: string
}

const pending = new Map<string, Pending>()

export async function startInstall(teamId: string): Promise<PlaudBindResult> {
  const { authorizeUrl, state } = await atlas.startPlaudOAuth(teamId)

  return new Promise<PlaudBindResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.delete(state)) {
        atlas.cancelPlaudOAuth(teamId, state).catch(() => {})
        reject(new Error('Plaud OAuth timed out — please try again.'))
      }
    }, INSTALL_TIMEOUT_MS)

    pending.set(state, { teamId, resolve, reject, timeout })
    shell.openExternal(authorizeUrl).catch((e: unknown) => {
      if (pending.delete(state)) {
        clearTimeout(timeout)
        atlas.cancelPlaudOAuth(teamId, state).catch(() => {})
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

export function cancelAllPending() {
  for (const [state, p] of pending) {
    clearTimeout(p.timeout)
    atlas.cancelPlaudOAuth(p.teamId, state).catch(() => {})
    p.reject(new Error('Plaud OAuth cancelled'))
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
    atlas.cancelPlaudOAuth(teamId, state).catch(() => {})
    p.reject(new Error('Plaud OAuth cancelled'))
  }
}

export function isCallbackUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)

    return u.hostname === PLAUD_CALLBACK_HOST || u.host === PLAUD_CALLBACK_HOST
  } catch {
    return false
  }
}

export async function handleCallback(rawUrl: string): Promise<void> {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    console.warn('[plaud-install] received malformed deep link:', rawUrl)

    return
  }
  if (parsed.hostname !== PLAUD_CALLBACK_HOST && parsed.host !== PLAUD_CALLBACK_HOST) return

  const state = parsed.searchParams.get('state')

  if (!state) {
    console.warn('[plaud-install] callback missing state — ignoring')

    return
  }
  const p = pending.get(state)

  if (!p) {
    console.warn('[plaud-install] callback state did not match any pending OAuth — ignoring')

    return
  }
  pending.delete(state)
  clearTimeout(p.timeout)
  const params = await connectorCallbackParams(parsed, p.teamId, atlas.completeConnectorOAuth)

  const error = params.get('error')

  if (error) {
    const description = params.get('error_description') || error

    p.reject(new Error(`Plaud OAuth failed: ${description}`))

    return
  }

  const bindingId = params.get('binding_id')
  const teamId = params.get('team_id') ?? p.teamId
  const accountName = params.get('account_name') ?? ''

  if (!bindingId) {
    p.reject(new Error('Plaud callback missing binding_id'))

    return
  }
  p.resolve({ bindingId, teamId, accountName })
}
