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
    '/opt/homebrew/bin',
    '/usr/local/bin',
    // The CLI bundled with the ChatGPT (Codex) desktop app, for users without a separate install.
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin',
  ]
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
  const command = provider === 'claude-code' ? 'claude' : provider
  const names = process.platform === 'win32' ? [`${command}.exe`, `${command}.cmd`] : [command]

  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name)

      if (executable(file)) return file
    }
  }
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
