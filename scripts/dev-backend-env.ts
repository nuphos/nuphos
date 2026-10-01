// Re-read .env on every (re)start: children spawn with `{...process.env, …}`
// and an inherited variable beats the .env the child loads itself, so edits
// would otherwise be silently ignored. Parsing is minimal, matching Bun's.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BACKEND_DIR, ROOT } from './dev-workspace.ts'

// Keys the last freshEnv() sourced from a file. A key deleted from .env would
// otherwise keep reaching the child from the boot-time process.env copy, so a
// restart could not unset anything — only change it.
let lastFileEnvKeys = new Set<string>()

// process.env with previously file-sourced keys that have since disappeared
// removed, so `{...inheritedEnv(), ...freshEnv()}` reflects deletions too.
function inheritedEnv(current: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }

  for (const key of lastFileEnvKeys) {
    if (!(key in current)) delete base[key]
  }

  return base
}

function freshEnv(files: string[]): Record<string, string> {
  const out: Record<string, string> = {}

  for (const file of files) {
    let text: string

    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const raw of text.split('\n')) {
      const line = raw.trim()

      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')

      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()

      if (!/^[A-Za-z_]\w*$/.test(key)) continue
      out[key] = line
        .slice(eq + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  lastFileEnvKeys = new Set(Object.keys(out))

  return out
}

// Only the backend reads .env files: loading them for the desktop would hand
// MONGODB_URI, JWT/Stripe/cloud secrets to Electron and its dependency tree;
// everything the desktop needs is set explicitly at its spawn site.
export function backendEnv(): NodeJS.ProcessEnv {
  const file = freshEnv([
    join(ROOT, '.env'),
    join(ROOT, '.env.local'),
    join(BACKEND_DIR, '.env'),
    join(BACKEND_DIR, '.env.local'),
  ])

  return { ...inheritedEnv(file), ...file }
}
