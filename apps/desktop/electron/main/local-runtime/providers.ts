import { mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

/** The agents a computer can run for Nuphos. */
export const LOCAL_AGENT_PROVIDERS = ['claude-code', 'codex', 'grok', 'opencode'] as const

export type LocalAgentProvider = (typeof LOCAL_AGENT_PROVIDERS)[number]

export const LOCAL_AGENT_NAMES: Record<LocalAgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  grok: 'Grok Build',
  opencode: 'OpenCode',
}

/**
 * Grok Build and OpenCode run behind the image's ACP shim, whose /home/node this home
 * stands in for. openab runs their login wrapper under its own HOME, so the shim and the
 * wrapper are both told the CLI and the home.
 */
export function shimEnv(cliPath: string, home: string): Record<string, string> {
  return { HOME: home, NUPHOS_AGENT_EXECUTABLE: cliPath, NUPHOS_AGENT_HOME: home }
}

/**
 * The HOME Grok Build or OpenCode runs with for Nuphos, as /home/node is in the
 * cloud runtime: it starts empty, so the owner's own login and config stay out,
 * and the agent's Sign in writes its credential here.
 */
export function prepareShimHome(provider: LocalAgentProvider, userDir: string): string | undefined {
  const home = path.join(userDir, `${provider}-home`)

  try {
    mkdirSync(home, { recursive: true, mode: 0o700 })

    return home
  } catch {
    return undefined
  }
}

/** Grok Build and OpenCode 1.x have no status command: their login is this file, as in the cloud runtime. */
const LOGIN_FILE: Partial<Record<LocalAgentProvider, string>> = {
  grok: '.grok/auth.json',
  opencode: '.local/share/opencode/auth.json',
}

/** Whether the agent's home holds its login; undefined for an agent its CLI reports on. */
export async function homeLogin(
  provider: LocalAgentProvider,
  agentHome: string,
): Promise<boolean | undefined> {
  const file = LOGIN_FILE[provider]

  if (!file) return undefined
  const found = await stat(path.join(agentHome, file)).catch(() => null)

  return Boolean(found?.isFile() && found.size > 2)
}
