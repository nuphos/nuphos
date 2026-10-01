import crypto from 'node:crypto'

import { shell } from 'electron'

import * as atlas from './atlas'

export const GITHUB_PROTOCOL = 'nuphos'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

type Pending = {
  teamId: string
  resolve: (installation: atlas.GithubInstallation) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

const pending = new Map<string, Pending>()

export async function startInstall(teamId: string): Promise<atlas.GithubInstallation> {
  const { url } = await atlas.getGithubInstallUrl(teamId)
  const state = crypto.randomBytes(16).toString('hex')

  const installUrl = new URL(url)

  installUrl.searchParams.set('state', state)

  return new Promise<atlas.GithubInstallation>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.delete(state)) {
        reject(new Error('GitHub App installation timed out — please try again.'))
      }
    }, INSTALL_TIMEOUT_MS)

    pending.set(state, { teamId, resolve, reject, timeout })
    shell.openExternal(installUrl.toString()).catch((e: unknown) => {
      if (pending.delete(state)) {
        clearTimeout(timeout)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

export function cancelAllPending() {
  for (const [, p] of pending) {
    clearTimeout(p.timeout)
    p.reject(new Error('GitHub App installation cancelled'))
  }
  pending.clear()
}

export function isCallbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)

    return parsed.protocol === `${GITHUB_PROTOCOL}:` && parsed.hostname === 'github-callback'
  } catch {
    return false
  }
}

export async function handleCallback(rawUrl: string): Promise<void> {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    console.warn('[github-install] received malformed deep link:', rawUrl)

    return
  }
  if (parsed.protocol !== `${GITHUB_PROTOCOL}:`) return
  if (parsed.hostname !== 'github-callback' && parsed.host !== 'github-callback') return

  const installationIdRaw = parsed.searchParams.get('installation_id')
  const state = parsed.searchParams.get('state')
  const setupAction = parsed.searchParams.get('setup_action') ?? 'install'

  if (!state) {
    console.warn('[github-install] callback missing state — ignoring')

    return
  }
  const p = pending.get(state)

  if (!p) {
    console.warn('[github-install] callback state did not match any pending install — ignoring')

    return
  }
  pending.delete(state)
  clearTimeout(p.timeout)

  if (setupAction !== 'install' && setupAction !== 'update') {
    p.reject(new Error(`Unexpected setup_action: ${setupAction}`))

    return
  }
  if (!installationIdRaw || !/^\d+$/.test(installationIdRaw)) {
    p.reject(new Error('GitHub did not return an installation_id'))

    return
  }
  const installationId = Number(installationIdRaw)

  try {
    const binding = await atlas.bindGithubInstallation(p.teamId, installationId)

    p.resolve(binding)
  } catch (e) {
    p.reject(e instanceof Error ? e : new Error(String(e)))
  }
}
