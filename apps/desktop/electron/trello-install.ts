import { shell } from 'electron'

import * as atlas from './atlas'
import { connectorCallbackError, connectorCallbackParams } from './connector-oauth-callback'

// Trello has its own deep-link host and uses the shared connector completion flow.
export const TRELLO_CALLBACK_HOST = 'trello-callback'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

type Pending = {
  teamId: string
  resolve: (result: TrelloBindResult) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

export type TrelloBindResult = {
  bindingId: string
  teamId: string
  accountName: string
}

const pending = new Map<string, Pending>()

/** Whether a callback's state still belongs to an attempt in progress. */
export const hasPending = (state: string) => pending.has(state)

export async function startInstall(teamId: string): Promise<TrelloBindResult> {
  const { authorizeUrl, state } = await atlas.startTrelloOAuth(teamId)

  return new Promise<TrelloBindResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.delete(state)) {
        atlas.cancelTrelloOAuth(teamId, state).catch(() => {})
        reject(new Error('Trello OAuth timed out — please try again.'))
      }
    }, INSTALL_TIMEOUT_MS)

    pending.set(state, { teamId, resolve, reject, timeout })
    shell.openExternal(authorizeUrl).catch(() => {
      if (pending.delete(state)) {
        clearTimeout(timeout)
        atlas.cancelTrelloOAuth(teamId, state).catch(() => {})
        reject(new Error('Could not open Trello authorization in your browser.'))
      }
    })
  })
}

export function cancelAllPending() {
  for (const [state, p] of pending) {
    clearTimeout(p.timeout)
    atlas.cancelTrelloOAuth(p.teamId, state).catch(() => {})
    p.reject(new Error('Trello OAuth cancelled'))
  }
  pending.clear()
}

// Cancel the server pending grant so a later browser approval cannot create a ghost binding.
export function cancelPending(teamId: string) {
  for (const [state, p] of pending) {
    if (p.teamId !== teamId) continue
    pending.delete(state)
    clearTimeout(p.timeout)
    atlas.cancelTrelloOAuth(teamId, state).catch(() => {})
    p.reject(new Error('Trello OAuth cancelled'))
  }
}

export function isCallbackUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)

    return u.protocol === 'nuphos:' && u.hostname === TRELLO_CALLBACK_HOST
  } catch {
    return false
  }
}

export async function handleCallback(rawUrl: string): Promise<void> {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    console.warn('[trello-install] received malformed deep link')

    return
  }
  if (parsed.protocol !== 'nuphos:' || parsed.hostname !== TRELLO_CALLBACK_HOST) return

  const state = parsed.searchParams.get('state')

  if (!state) {
    console.warn('[trello-install] callback missing state — ignoring')

    return
  }
  const p = pending.get(state)

  if (!p) {
    console.warn('[trello-install] callback state did not match any pending OAuth — ignoring')

    return
  }
  pending.delete(state)
  clearTimeout(p.timeout)
  const params = await connectorCallbackParams(parsed, p.teamId, atlas.completeConnectorOAuth)

  const error = params.get('error')

  if (error) {
    p.reject(connectorCallbackError('Trello', params))

    return
  }

  const bindingId = params.get('binding_id')
  const teamId = params.get('team_id') ?? p.teamId
  const accountName = params.get('account_name') ?? ''

  if (!bindingId) {
    p.reject(new Error('Trello callback missing binding_id'))

    return
  }
  p.resolve({ bindingId, teamId, accountName })
}
