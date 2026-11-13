import path from 'node:path'

import {
  claudeDesktopClis,
  envValue,
  executable,
  homeOf,
  windowsStoreClis,
} from './agent-cli-apps.ts'

import type { LocalAgentProvider } from './agent-cli.ts'

function fallbackDirs(home: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform === 'win32') {
    const appData = envValue(env, 'APPDATA') ?? path.join(home, 'AppData', 'Roaming')
    const localAppData = envValue(env, 'LOCALAPPDATA') ?? path.join(home, 'AppData', 'Local')

    return [
      path.join(home, '.local', 'bin'),
      path.join(appData, 'npm'),
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      // Command aliases of Microsoft Store apps.
      path.join(localAppData, 'Microsoft', 'WindowsApps'),
    ]
  }

  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    // OpenCode's own installer (opencode.ai/install), which only adds it to PATH in some shells.
    path.join(home, '.opencode', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
}

/** The CLI a macOS desktop app ships inside itself. */
const MAC_APP_CLI: Partial<Record<LocalAgentProvider, string>> = {
  codex: path.join('ChatGPT.app', 'Contents', 'Resources', 'codex-cli', 'bin', 'codex'),
  opencode: path.join('OpenCode.app', 'Contents', 'Resources', 'opencode-cli'),
}

/** The CLI a desktop app ships, for users without a separate install: the ChatGPT app carries
 *  Codex, and the OpenCode app carries OpenCode as `opencode-cli`, never on PATH. */
function appClis(provider: LocalAgentProvider, home: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform === 'darwin') {
    const inside = MAC_APP_CLI[provider]

    return inside
      ? ['/Applications', path.join(home, 'Applications')].map((dir) => path.join(dir, inside))
      : []
  }
  if (provider !== 'opencode') return []
  if (process.platform === 'win32') {
    const localAppData = envValue(env, 'LOCALAPPDATA') ?? path.join(home, 'AppData', 'Local')

    return [path.join(localAppData, 'Programs', 'OpenCode', 'resources', 'opencode-cli.exe')]
  }

  return ['/opt/OpenCode/resources/opencode-cli']
}

/** The last CLI found inside a Microsoft Store app, which only an async lookup can find. */
const storeCli: Partial<Record<LocalAgentProvider, string>> = {}

/** The CLI a terminal would run, falling back to the installers' default locations and
 *  then to the copy a desktop app (Claude, ChatGPT) keeps for itself. */
export function findAgentCli(provider: LocalAgentProvider, env: NodeJS.ProcessEnv): string | null {
  const home = homeOf(env)
  const dirs = [
    ...(envValue(env, 'PATH') ?? '').split(path.delimiter).filter(Boolean),
    ...fallbackDirs(home, env),
  ]
  const command =
    ({ 'claude-code': 'claude', antigravity: 'agy' } as Record<string, string>)[provider] ??
    provider
  const names = process.platform === 'win32' ? [`${command}.exe`, `${command}.cmd`] : [command]

  for (const file of [
    ...dirs.flatMap((dir) => names.map((name) => path.join(dir, name))),
    ...appClis(provider, home, env),
  ])
    if (executable(file)) return file
  if (provider === 'claude-code') {
    const [desktop] = claudeDesktopClis(env)

    if (desktop) return desktop
  }
  const stored = storeCli[provider]

  return stored && executable(stored) ? stored : null
}

/** findAgentCli, after also looking inside the Microsoft Store apps on Windows. */
export async function locateAgentCli(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const found = findAgentCli(provider, env)

  if (found || process.platform !== 'win32') return found
  const [store] = await windowsStoreClis(provider)

  if (store) storeCli[provider] = store

  return store ?? null
}
