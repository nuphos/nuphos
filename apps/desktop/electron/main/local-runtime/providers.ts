import { mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

/** The agents a computer can run for Nuphos. */
export const LOCAL_AGENT_PROVIDERS = [
  'claude-code',
  'codex',
  'grok',
  'antigravity',
  'opencode',
  'dsh',
] as const

export type LocalAgentProvider = (typeof LOCAL_AGENT_PROVIDERS)[number]

export const LOCAL_AGENT_NAMES: Record<LocalAgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  grok: 'Grok Build',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  dsh: 'DeepSeek Harness',
}

/**
 * Grok Build, Antigravity, OpenCode and DeepSeek Harness run behind the image's ACP shim,
 * whose /home/node this home stands in for. openab runs their login wrapper under its own
 * HOME, so the shim and the wrapper are both told the CLI and the home.
 */
export function shimEnv(cliPath: string, home: string): Record<string, string> {
  return { HOME: home, NUPHOS_AGENT_EXECUTABLE: cliPath, NUPHOS_AGENT_HOME: home }
}

/**
 * The HOME a native ACP agent runs with for Nuphos, as /home/node is in the
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

/** Grok Build, OpenCode 1.x and DeepSeek Harness have no status command: their login is
 *  this file, as in the cloud runtime. */
const LOGIN_FILE: Partial<Record<LocalAgentProvider, string>> = {
  grok: '.grok/auth.json',
  opencode: '.local/share/opencode/auth.json',
  dsh: '.dsh/.credentials.yaml',
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

/** An agent never serves Nuphos from the owner's own home, where their personal config lives. */
export const AGENT_HOME_UNAVAILABLE: Record<LocalAgentProvider, string> = {
  'claude-code': 'Nuphos could not prepare a separate Claude Code home on this computer.',
  codex: 'Sign in to Codex on this computer with `codex login`, then check again.',
  grok: 'Nuphos could not prepare a separate Grok Build home on this computer.',
  antigravity: 'Nuphos could not prepare a separate Antigravity home on this computer.',
  opencode: 'Nuphos could not prepare a separate OpenCode home on this computer.',
  dsh: 'Nuphos could not prepare a separate DeepSeek Harness home on this computer.',
}

export const INSTALL_HINT: Record<LocalAgentProvider, string> = {
  'claude-code': 'Install Claude Code on this computer to run it as a local runtime.',
  codex: 'Install Codex on this computer to run it as a local runtime.',
  grok: 'Install Grok Build on this computer to run it as a local runtime.',
  antigravity:
    'Install Antigravity CLI 1.5.0 or newer on this computer to run it as a local runtime.',
  opencode: 'Install OpenCode on this computer to run it as a local runtime.',
  dsh: 'Install DeepSeek Harness with `npm install -g @deepseek-ai/dsh` (Node.js 24.9 or newer) to run it as a local runtime.',
}
