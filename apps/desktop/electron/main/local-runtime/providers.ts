import { mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import type { LocalAgentProvider } from '../../../src/api/local-agent-providers.ts'

export { LOCAL_AGENT_PROVIDERS } from '../../../src/api/local-agent-providers.ts'
export type { LocalAgentProvider } from '../../../src/api/local-agent-providers.ts'

export const LOCAL_AGENT_NAMES: Record<LocalAgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  grok: 'Grok Build',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  dsh: 'DeepSeek Harness',
  hermes: 'Hermes Agent',
  pi: 'Pi',
}

/**
 * Grok Build, Antigravity, OpenCode, DeepSeek Harness, Hermes Agent and Pi run behind the image's
 * ACP shim, whose /home/node this home stands in for. openab runs their login wrapper under its own
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

/** The home an agent runs with for Nuphos, under the user's own directory. */
export const agentHomeName = (provider: LocalAgentProvider) =>
  provider === 'claude-code' ? 'claude-home' : `${provider}-home`

/** Grok Build, OpenCode 1.x, DeepSeek Harness, Hermes Agent and Pi are asked for no status:
 *  their login is this file, as in the cloud runtime. */
export const LOGIN_FILE: Partial<Record<LocalAgentProvider, string>> = {
  grok: '.grok/auth.json',
  opencode: '.local/share/opencode/auth.json',
  dsh: '.dsh/.credentials.yaml',
  hermes: '.hermes/auth.json',
  pi: '.pi/agent/auth.json',
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
  hermes: 'Nuphos could not prepare a separate Hermes Agent home on this computer.',
  pi: 'Nuphos could not prepare a separate Pi home on this computer.',
}

export const INSTALL_HINT: Record<LocalAgentProvider, string> = {
  'claude-code': 'Install Claude Code on this computer to run it as a local runtime.',
  codex: 'Install Codex on this computer to run it as a local runtime.',
  grok: 'Install Grok Build on this computer to run it as a local runtime.',
  antigravity:
    'Install Antigravity CLI 1.5.0 or newer on this computer to run it as a local runtime.',
  opencode: 'Install OpenCode on this computer to run it as a local runtime.',
  dsh: 'Install DeepSeek Harness with `npm install -g @deepseek-ai/dsh` (Node.js 24.9 or newer) to run it as a local runtime.',
  hermes:
    'Install Hermes Agent with its one-line installer from hermes-agent.nousresearch.com, which sets up Python and uv itself, to run it as a local runtime.',
  pi: 'Install Pi with `npm install -g @earendil-works/pi-coding-agent` (Node.js 22.19 or newer) to run it as a local runtime.',
}
