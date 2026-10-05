// The backend this app talks to: a launch-time NUPHOS_API_URL (e.g. from
// `bun run dev`), else the endpoint saved on the sign-in screen, else Nuphos
// Cloud. It lives in process.env so spawned helpers inherit it, and is read
// per call, so changing it takes effect without a relaunch.

import fs from 'node:fs'
import path from 'node:path'

import { CLI_CONFIG_PATH } from './cli-config-path.ts'

const DEFAULT_API_URL = 'https://api.nuphos.ai'

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

/** Saves the endpoint (`null` restores Nuphos Cloud) and returns the new one. */
export function setApiUrl(raw: string | null): string {
  delete process.env.ATLAS_API_URL
  if (raw === null) {
    fs.rmSync(SAVED_PATH, { force: true })
    delete process.env.NUPHOS_API_URL
  } else {
    const url = new URL(raw.trim())

    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Not an http(s) URL')
    fs.mkdirSync(path.dirname(SAVED_PATH), { recursive: true })
    fs.writeFileSync(SAVED_PATH, `${url.origin}\n`, 'utf8')
    process.env.NUPHOS_API_URL = url.origin
  }

  return apiUrl()
}
