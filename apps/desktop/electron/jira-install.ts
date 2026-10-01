import { shell } from 'electron'

import * as atlas from './atlas'

// Shared scheme with linear-install / github-install — jira uses a distinct
// hostname (nuphos://jira-callback) so the dispatcher in main.ts can route by
// it without colliding.
export const JIRA_CALLBACK_HOST = 'jira-callback'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

type Pending = {
  teamId: string
  resolve: (result: JiraBindResult) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

export type JiraBindResult = {
  bindingId: string
  teamId: string
  siteName: string
}

const pending = new Map<string, Pending>()

export async function startInstall(teamId: string): Promise<JiraBindResult> {
  const { authorizeUrl, state } = await atlas.startJiraOAuth(teamId)

  return new Promise<JiraBindResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.delete(state)) {
        atlas.cancelJiraOAuth(teamId, state).catch(() => {})
        reject(new Error('Jira OAuth timed out — please try again.'))
      }
    }, INSTALL_TIMEOUT_MS)

    pending.set(state, { teamId, resolve, reject, timeout })
    shell.openExternal(authorizeUrl).catch((e: unknown) => {
      if (pending.delete(state)) {
        clearTimeout(timeout)
        atlas.cancelJiraOAuth(teamId, state).catch(() => {})
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

export function cancelAllPending() {
  for (const [state, p] of pending) {
    clearTimeout(p.timeout)
    atlas.cancelJiraOAuth(p.teamId, state).catch(() => {})
    p.reject(new Error('Jira OAuth cancelled'))
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
    atlas.cancelJiraOAuth(teamId, state).catch(() => {})
    p.reject(new Error('Jira OAuth cancelled'))
  }
}

export function isCallbackUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)

    return u.hostname === JIRA_CALLBACK_HOST || u.host === JIRA_CALLBACK_HOST
  } catch {
    return false
  }
}

export async function handleCallback(rawUrl: string): Promise<void> {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    console.warn('[jira-install] received malformed deep link:', rawUrl)

    return
  }
  if (parsed.hostname !== JIRA_CALLBACK_HOST && parsed.host !== JIRA_CALLBACK_HOST) return

  const state = parsed.searchParams.get('state')

  if (!state) {
    console.warn('[jira-install] callback missing state — ignoring')

    return
  }
  const p = pending.get(state)

  if (!p) {
    console.warn('[jira-install] callback state did not match any pending OAuth — ignoring')

    return
  }
  pending.delete(state)
  clearTimeout(p.timeout)

  const error = parsed.searchParams.get('error')

  if (error) {
    const description = parsed.searchParams.get('error_description') || error

    p.reject(new Error(`Jira OAuth failed: ${description}`))

    return
  }

  const bindingId = parsed.searchParams.get('binding_id')
  const teamId = parsed.searchParams.get('team_id') ?? p.teamId
  const siteName = parsed.searchParams.get('site_name') ?? ''

  if (!bindingId) {
    p.reject(new Error('Jira callback missing binding_id'))

    return
  }
  p.resolve({ bindingId, teamId, siteName })
}
