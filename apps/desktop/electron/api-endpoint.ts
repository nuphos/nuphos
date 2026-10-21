// The backend this app talks to: a launch-time NUPHOS_API_URL (e.g. from
// `bun run dev`), else the endpoint saved on the sign-in screen, else Nuphos
// Cloud. It lives in process.env so spawned helpers inherit it, and is read
// per call, so changing it takes effect without a relaunch.

import fs from 'node:fs'
import path from 'node:path'

import { CLI_CONFIG_PATH } from './cli-config-path.ts'

const DEFAULT_API_URL = 'https://api.nuphos.ai'
const listeners = new Set<() => void>()

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

export function apiUrl(): string {
  return process.env.NUPHOS_API_URL || process.env.ATLAS_API_URL || DEFAULT_API_URL
}

// The backend a sign-in in progress talks to, when it is not the current one:
// adding an account on another backend must not move the signed-in account
// there before the new sign-in completes.
let staged: string | null = null

/** Where a sign-in in progress goes: the staged backend, else the current one. */
export function loginApiUrl(): string {
  return staged ?? apiUrl()
}

/** Stages the backend for the next sign-in (`null` drops it) and returns where sign-ins go. */
export function stageLoginApiUrl(raw: string | null): string {
  if (raw === null) {
    staged = null
  } else {
    const url = new URL(raw.trim())

    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Not an http(s) URL')
    staged = url.origin === apiUrl() ? null : url.origin
  }

  return loginApiUrl()
}

/** A dev window may use Cloud, but must not advertise this computer there. */
export function deviceRegistrationAllowed(dev: boolean): boolean {
  if (!dev) return true

  return new URL(apiUrl()).hostname.replace(/\.$/u, '') !== new URL(DEFAULT_API_URL).hostname
}

export function onApiUrlChange(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Saves the endpoint (`null` restores the launch-time one, else Nuphos Cloud) and returns the new one. */
export function setApiUrl(raw: string | null): string {
  const previous = apiUrl()

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

  if (apiUrl() !== previous) for (const listener of listeners) listener()

  return apiUrl()
}
