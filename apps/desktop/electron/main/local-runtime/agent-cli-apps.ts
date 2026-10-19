import { execFile } from 'node:child_process'
import { accessSync, constants, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { LocalAgentProvider } from './agent-cli.ts'

/** Reads an environment variable the way Windows does: names are case-insensitive there,
 *  and a copied `process.env` keeps whatever case the system used (`Path`, not `PATH`). */
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (env[name] !== undefined) return env[name]
  if (process.platform !== 'win32') return

  const upper = name.toUpperCase()
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === upper)

  return key === undefined ? undefined : env[key]
}

export function homeOf(env: NodeJS.ProcessEnv): string {
  return envValue(env, 'HOME') ?? envValue(env, 'USERPROFILE') ?? os.homedir()
}

/** Windows PowerShell by its fixed path, so a writable PATH entry cannot stand in for it. */
export function powershellPath(env: NodeJS.ProcessEnv): string {
  const root = envValue(env, 'SystemRoot') ?? 'C:\\Windows'

  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

export function executable(file: string): boolean {
  try {
    accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK)

    return true
  } catch {
    return false
  }
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function byVersionDesc(a: string, b: string): number {
  const parts = (version: string) => version.split(/[.+-]/u, 3).map(Number)
  const [left, right] = [parts(a), parts(b)]

  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return (right[i] ?? 0) - (left[i] ?? 0)

  return 0
}

/** Where the Claude desktop app keeps its data, including the copy a Microsoft Store
 *  install redirects into its package's private `LocalCache`. */
function claudeDesktopDataDirs(env: NodeJS.ProcessEnv): string[] {
  const home = homeOf(env)

  if (process.platform === 'darwin')
    return [path.join(home, 'Library', 'Application Support', 'Claude')]
  if (process.platform !== 'win32')
    return [path.join(envValue(env, 'XDG_CONFIG_HOME') ?? path.join(home, '.config'), 'Claude')]

  const appData = envValue(env, 'APPDATA') ?? path.join(home, 'AppData', 'Roaming')
  const localAppData = envValue(env, 'LOCALAPPDATA') ?? path.join(home, 'AppData', 'Local')
  const packages = path.join(localAppData, 'Packages')
  const storeCopies = list(packages)
    .filter((name) => /claude/iu.test(name))
    .map((name) => path.join(packages, name, 'LocalCache', 'Roaming', 'Claude'))

  return [path.join(appData, 'Claude'), ...storeCopies]
}

/** The Claude Code the Claude desktop app downloads for its Code tab:
 *  `claude-code/<version>/[<digest>/]claude(.exe|.app/Contents/MacOS/claude)`, newest first. */
export function claudeDesktopClis(env: NodeJS.ProcessEnv): string[] {
  const names =
    process.platform === 'win32'
      ? ['claude.exe']
      : process.platform === 'darwin'
        ? [path.join('claude.app', 'Contents', 'MacOS', 'claude'), 'claude']
        : ['claude']
  const found: string[] = []

  for (const data of claudeDesktopDataDirs(env)) {
    const root = path.join(data, 'claude-code')

    for (const version of list(root)
      .filter((name) => /^\d+\.\d+\.\d+/u.test(name))
      .sort(byVersionDesc)) {
      const dir = path.join(root, version)
      const dirs = [dir, ...list(dir).map((name) => path.join(dir, name))]

      for (const candidate of dirs.flatMap((parent) =>
        names.map((name) => path.join(parent, name)),
      ))
        if (executable(candidate)) found.push(candidate)
    }
  }

  return found
}

const PACKAGE_TIMEOUT_MS = 10_000
const PACKAGE_TTL_MS = 5 * 60_000
const SEARCH_DEPTH = 4
/** Microsoft Store packages that carry an agent CLI: the ChatGPT / Codex app ships codex.exe. */
const STORE_PACKAGES: Record<LocalAgentProvider, RegExp> = {
  'claude-code': /claude/iu,
  codex: /openai|chatgpt|codex/iu,
}

let storePackages: { at: number; locations: Promise<string[]> } | null = null

/** Install folders of the user's Microsoft Store apps, asked once and cached: the
 *  WindowsApps root cannot be listed, but a package's own folder can be read and run. */
function windowsStorePackages(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  if (storePackages && Date.now() - storePackages.at < PACKAGE_TTL_MS)
    return storePackages.locations

  const locations = new Promise<string[]>((resolve) => {
    execFile(
      powershellPath(process.env),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-AppxPackage | Where-Object { $_.Name -match 'openai|chatgpt|codex|claude' } | ForEach-Object { $_.Name + '|' + $_.InstallLocation }",
      ],
      { timeout: PACKAGE_TIMEOUT_MS, windowsHide: true },
      (error, stdout) =>
        resolve(error ? [] : stdout.split(/\r?\n/u).filter((line) => line.includes('|'))),
    )
  })

  storePackages = { at: Date.now(), locations }

  return locations
}

/** After installing a Store app, so the next probe sees it. */
export function forgetWindowsStorePackages(): void {
  storePackages = null
}

function findFile(dir: string, name: string, depth: number): string | null {
  const direct = path.join(dir, name)

  if (executable(direct)) return direct
  if (depth === 0) return null
  for (const entry of list(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const found = findFile(path.join(dir, entry), name, depth - 1)

    if (found) return found
  }

  return null
}

/** The agent CLI inside an installed Microsoft Store app, such as codex.exe in the ChatGPT app. */
export async function windowsStoreClis(provider: LocalAgentProvider): Promise<string[]> {
  const name = provider === 'codex' ? 'codex.exe' : 'claude.exe'
  const found: string[] = []

  for (const line of await windowsStorePackages()) {
    const [pkg = '', location = ''] = line.split('|')

    if (!location || !STORE_PACKAGES[provider].test(pkg)) continue
    const file = findFile(location.trim(), name, SEARCH_DEPTH)

    if (file) found.push(file)
  }

  return found
}

/** A CLI that a desktop app downloaded or ships, which that app keeps up to date. */
export function appManagedCli(file: string, env: NodeJS.ProcessEnv): boolean {
  const normalized = path.normalize(file).toLowerCase()

  return (
    normalized.includes(`.app${path.sep}contents${path.sep}`) ||
    // Store apps, and their command aliases under %LOCALAPPDATA%\Microsoft\WindowsApps.
    normalized.includes(`${path.sep}windowsapps${path.sep}`) ||
    claudeDesktopDataDirs(env).some((dir) =>
      normalized.startsWith(`${path.join(dir, 'claude-code').toLowerCase()}${path.sep}`),
    )
  )
}
