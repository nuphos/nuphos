import { shell } from 'electron'

import * as atlas from './atlas'

// Shared scheme with github-install — gitlab uses a different hostname
// (nuphos://gitlab-callback) so the dispatcher in main.ts can route by
// it without colliding.
export const GITLAB_CALLBACK_HOST = 'gitlab-callback'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

type Pending = {
  teamId: string
  resolve: (result: GitlabBindResult) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

export type GitlabBindResult = {
  bindingId: string
  teamId: string
  hostUrl: string
  username: string
}

const pending = new Map<string, Pending>()

export async function startInstall(
  teamId: string,
  hostUrl: string,
  clientId?: string,
  clientSecret?: string,
  scopes?: string[],
): Promise<GitlabBindResult> {
  const { authorizeUrl, state } = await atlas.startGitlabOAuth(
    teamId,
    hostUrl,
    clientId,
    clientSecret,
    scopes,
  )

  return new Promise<GitlabBindResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.delete(state)) {
        atlas.cancelGitlabOAuth(teamId, state).catch(() => {})
        reject(new Error('GitLab OAuth timed out — please try again.'))
      }
    }, INSTALL_TIMEOUT_MS)

    pending.set(state, { teamId, resolve, reject, timeout })
    shell.openExternal(authorizeUrl).catch((e: unknown) => {
      if (pending.delete(state)) {
        clearTimeout(timeout)
        atlas.cancelGitlabOAuth(teamId, state).catch(() => {})
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

export function cancelAllPending() {
  for (const [state, p] of pending) {
    clearTimeout(p.timeout)
    atlas.cancelGitlabOAuth(p.teamId, state).catch(() => {})
    p.reject(new Error('GitLab OAuth cancelled'))
  }
  pending.clear()
}

// Renderer-initiated cancel (dialog dismissed while waiting). Deleting the
// backend pending record right away — instead of waiting for the 10-minute
// timeout — also invalidates the authorize URL still open in the browser, so
// a late approval can't create a binding the UI never hears about.
export function cancelPending(teamId: string) {
  for (const [state, p] of pending) {
    if (p.teamId !== teamId) continue
    pending.delete(state)
    clearTimeout(p.timeout)
    atlas.cancelGitlabOAuth(teamId, state).catch(() => {})
    p.reject(new Error('GitLab OAuth cancelled'))
  }
}

export function isCallbackUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)

    return u.hostname === GITLAB_CALLBACK_HOST || u.host === GITLAB_CALLBACK_HOST
  } catch {
    return false
  }
}

export async function handleCallback(rawUrl: string): Promise<void> {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    console.warn('[gitlab-install] received malformed deep link:', rawUrl)

    return
  }
  if (parsed.hostname !== GITLAB_CALLBACK_HOST && parsed.host !== GITLAB_CALLBACK_HOST) return

  const state = parsed.searchParams.get('state')

  if (!state) {
    console.warn('[gitlab-install] callback missing state — ignoring')

    return
  }
  const p = pending.get(state)

  if (!p) {
    console.warn('[gitlab-install] callback state did not match any pending OAuth — ignoring')

    return
  }
  pending.delete(state)
  clearTimeout(p.timeout)

  const error = parsed.searchParams.get('error')

  if (error) {
    const description = parsed.searchParams.get('error_description') || error

    p.reject(new Error(`GitLab OAuth failed: ${description}`))

    return
  }

  const bindingId = parsed.searchParams.get('binding_id')
  const teamId = parsed.searchParams.get('team_id') ?? p.teamId
  const hostUrl = parsed.searchParams.get('host_url') ?? ''
  const username = parsed.searchParams.get('username') ?? ''

  if (!bindingId) {
    p.reject(new Error('GitLab callback missing binding_id'))

    return
  }
  p.resolve({ bindingId, teamId, hostUrl, username })
}
