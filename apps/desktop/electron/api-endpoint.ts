// The backend this app talks to: a launch-time NUPHOS_API_URL (e.g. from
// `bun run dev`), else the endpoint saved on the sign-in screen, else Nuphos
// Cloud. It is part of the account context (auth-session.ts), so a request's
// backend and token are always read together, and is mirrored in process.env
// so spawned helpers inherit it.

import fs from 'node:fs'
import path from 'node:path'

import { normalizedApi } from './auth/accounts.ts'
import { authSession } from './auth-session.ts'
import { CLI_CONFIG_PATH } from './cli-config-path.ts'

const DEFAULT_API_URL = 'https://api.nuphos.ai'

// What this process was launched with; resetting the switch returns here, so a
// `bun run dev` build never falls through to Nuphos Cloud.
const LAUNCH_API_URL = process.env.NUPHOS_API_URL || process.env.ATLAS_API_URL || ''

// Paired with the sign-in file (cli.yaml → cli.api-url), so `bun run dev`'s
// cli.dev.yaml never shares an endpoint with the installed app.
const SAVED_PATH = `${CLI_CONFIG_PATH.replace(/\.ya?ml$/, '')}.api-url`

if (!process.env.NUPHOS_API_URL && !process.env.ATLAS_API_URL) {
  try {
    const saved = fs.readFileSync(SAVED_PATH, 'utf8').trim()

    if (saved) process.env.NUPHOS_API_URL = saved
  } catch {
    // No saved endpoint: use the default.
  }
}

function fromEnv(): string {
  return process.env.NUPHOS_API_URL || process.env.ATLAS_API_URL || DEFAULT_API_URL
}

authSession.start(fromEnv())

export function apiUrl(): string {
  return authSession.context().api
}

/** A dev window may use Cloud, but must not advertise this computer there. */
export function deviceRegistrationAllowed(dev: boolean): boolean {
  if (!dev) return true

  return new URL(apiUrl()).hostname.replace(/\.$/u, '') !== new URL(DEFAULT_API_URL).hostname
}

/**
 * Saves the endpoint (`null` restores the launch-time one, else Nuphos Cloud)
 * and returns the new one. A different backend ends the session in memory.
 */
export function setApiUrl(raw: string | null): string {
  saveEndpoint(raw)
  authSession.moveTo(fromEnv())

  return apiUrl()
}

/** Saves `api` as the backend for the next launch and for the CLI; throws if it cannot. */
export function keepBackend(api: string): void {
  if (normalizedApi(api) !== normalizedApi(apiUrl())) saveEndpoint(api)
}

/**
 * Signs in, in memory, as an account on the backend that issued its token, in
 * one step: nothing sees the token paired with another backend.
 */
export function useAccount(api: string, token: string | null, userId: string | null): void {
  const same = normalizedApi(api) === normalizedApi(apiUrl())

  authSession.use(same ? apiUrl() : normalizedApi(api), token, userId)
}

/** Writes the endpoint for the next launch and the CLI, and for helpers this process spawns. */
function saveEndpoint(raw: string | null): void {
  delete process.env.ATLAS_API_URL
  if (raw === null) {
    fs.rmSync(SAVED_PATH, { force: true })
    if (LAUNCH_API_URL) process.env.NUPHOS_API_URL = LAUNCH_API_URL
    else delete process.env.NUPHOS_API_URL
  } else {
    const url = new URL(raw.trim())

    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Not an http(s) URL')
    fs.mkdirSync(path.dirname(SAVED_PATH), { recursive: true })
    fs.writeFileSync(SAVED_PATH, `${url.origin}\n`, 'utf8')
    process.env.NUPHOS_API_URL = url.origin
  }
}
