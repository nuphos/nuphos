// The backend this app talks to: a launch-time NUPHOS_API_URL (e.g. from
// `bun run dev`), else the endpoint saved on the sign-in screen, else Nuphos
// Cloud. It is half of the account context (see account-context.ts), changed
// only together with the session token, and mirrored into process.env so
// spawned helpers inherit it.

import fs from 'node:fs'
import path from 'node:path'

import { AccountContexts } from './account-context.ts'
import { CLI_CONFIG_PATH } from './cli-config-path.ts'

const DEFAULT_API_URL = 'https://api.nuphos.ai'

// What this process was launched with; resetting the switch returns here, so a
// `bun run dev` build never falls through to Nuphos Cloud.
const LAUNCH_API_URL = process.env.NUPHOS_API_URL || process.env.ATLAS_API_URL || ''

// Paired with the sign-in file (cli.yaml → cli.api-url), so `bun run dev`'s
// cli.dev.yaml never shares an endpoint with the installed app.
const SAVED_PATH = `${CLI_CONFIG_PATH.replace(/\.ya?ml$/, '')}.api-url`

function savedApiUrl(): string {
  try {
    return fs.readFileSync(SAVED_PATH, 'utf8').trim()
  } catch {
    // No saved endpoint: use the default.
    return ''
  }
}

/** The account this app acts as: a backend and the token it issued, changed only as a pair. */
export const accountContext = new AccountContexts(
  LAUNCH_API_URL || savedApiUrl() || DEFAULT_API_URL,
  (api) => {
    delete process.env.ATLAS_API_URL
    process.env.NUPHOS_API_URL = api
  },
)

export function apiUrl(): string {
  return accountContext.current().api
}

// The backend a sign-in in progress talks to, when it is not the current one:
// adding an account on another backend must not move the signed-in account
// there before the new sign-in completes.
let staged: string | null = null
const loginListeners = new Set<(url: string) => void>()

/** Follows where sign-ins go, so every window adding an account shows the same server. */
export function onLoginApiUrlChange(listener: (url: string) => void): () => void {
  loginListeners.add(listener)

  return () => {
    loginListeners.delete(listener)
  }
}

/** Where a sign-in in progress goes: the staged backend, else the current one. */
export function loginApiUrl(): string {
  return staged ?? apiUrl()
}

/** Stages the backend for the next sign-in (`null` drops it) and returns where sign-ins go. */
export function stageLoginApiUrl(raw: string | null): string {
  const before = loginApiUrl()

  if (raw === null) {
    staged = null
  } else {
    const url = new URL(raw.trim())

    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Not an http(s) URL')
    staged = url.origin === apiUrl() ? null : url.origin
  }
  if (loginApiUrl() !== before) for (const listener of loginListeners) listener(loginApiUrl())

  return loginApiUrl()
}

/** A dev window may use Cloud, but must not advertise this computer there. */
export function deviceRegistrationAllowed(dev: boolean): boolean {
  if (!dev) return true

  return new URL(apiUrl()).hostname.replace(/\.$/u, '') !== new URL(DEFAULT_API_URL).hostname
}

/** Follows the backend, after it and its token have both taken effect. */
export function onApiUrlChange(listener: () => void): () => void {
  return accountContext.subscribe((next, prev) => {
    if (next.api !== prev.api) listener()
  })
}

/**
 * Saves the endpoint chosen on the sign-in screen (`null` restores the
 * launch-time one, else Nuphos Cloud) and returns the new one. The endpoint
 * is shared with the CLI. A token never follows it to another backend: a
 * session on the old backend is signed out of instead.
 */
export function setApiUrl(raw: string | null): string {
  let api = LAUNCH_API_URL || DEFAULT_API_URL

  if (raw === null) {
    fs.rmSync(SAVED_PATH, { force: true })
  } else {
    const url = new URL(raw.trim())

    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Not an http(s) URL')
    fs.mkdirSync(path.dirname(SAVED_PATH), { recursive: true })
    fs.writeFileSync(SAVED_PATH, `${url.origin}\n`, 'utf8')
    api = url.origin
  }
  if (api !== apiUrl()) accountContext.swap({ api, token: null }, 'endpoint')

  return apiUrl()
}
