import { shell } from 'electron'

import * as atlas from './atlas'

export const SLACK_CALLBACK_HOST = 'slack-callback'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

type Pending = {
  teamId: string
  resolve: (result: SlackInstallResult) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

export type SlackInstallResult = {
  bindingId: string
  teamId: string
  slackTeamName: string
}

const pending = new Map<string, Pending>()

export async function startInstall(teamId: string): Promise<SlackInstallResult> {
  const { authorizeUrl, state } = await atlas.startSlackOAuth(teamId)

  return new Promise<SlackInstallResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.delete(state)) {
        atlas.cancelSlackOAuth(teamId, state).catch(() => {})
        reject(new Error('Slack install timed out — please try again.'))
      }
    }, INSTALL_TIMEOUT_MS)

    pending.set(state, { teamId, resolve, reject, timeout })
    shell.openExternal(authorizeUrl).catch((e: unknown) => {
      if (pending.delete(state)) {
        clearTimeout(timeout)
        atlas.cancelSlackOAuth(teamId, state).catch(() => {})
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

export function cancelAllPending() {
  for (const [state, p] of pending) {
    clearTimeout(p.timeout)
    atlas.cancelSlackOAuth(p.teamId, state).catch(() => {})
    p.reject(new Error('Slack install cancelled'))
  }
  pending.clear()
}

export function cancelPending(teamId: string) {
  for (const [state, p] of pending) {
    if (p.teamId !== teamId) continue
    pending.delete(state)
    clearTimeout(p.timeout)
    atlas.cancelSlackOAuth(teamId, state).catch(() => {})
    p.reject(new Error('Slack install cancelled'))
  }
}

export function isCallbackUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)

    return u.hostname === SLACK_CALLBACK_HOST || u.host === SLACK_CALLBACK_HOST
  } catch {
    return false
  }
}

export async function handleCallback(rawUrl: string): Promise<void> {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    console.warn('[slack-install] received malformed deep link:', rawUrl)

    return
  }
  if (parsed.hostname !== SLACK_CALLBACK_HOST && parsed.host !== SLACK_CALLBACK_HOST) return

  const state = parsed.searchParams.get('state')

  if (!state) {
    console.warn('[slack-install] callback missing state — ignoring')

    return
  }
  const p = pending.get(state)

  if (!p) {
    console.warn('[slack-install] callback state did not match any pending OAuth — ignoring')

    return
  }
  pending.delete(state)
  clearTimeout(p.timeout)

  const error = parsed.searchParams.get('error')

  if (error) {
    void atlas.cancelSlackOAuth(p.teamId, state).catch(() => {})
    const description = parsed.searchParams.get('error_description') || error

    p.reject(new Error(`Slack install failed: ${description}`))

    return
  }

  const bindingId = parsed.searchParams.get('binding_id')
  const teamId = parsed.searchParams.get('team_id') ?? p.teamId
  const slackTeamName = parsed.searchParams.get('slack_team_name') ?? ''

  if (!bindingId) {
    void atlas.cancelSlackOAuth(p.teamId, state).catch(() => {})
    p.reject(new Error('Slack callback missing binding_id'))

    return
  }
  p.resolve({ bindingId, teamId, slackTeamName })
}
