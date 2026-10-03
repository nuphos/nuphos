import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { agentCliEnv } from './config.ts'

export type LocalAgentProvider = 'claude-code' | 'codex'

export const LOCAL_AGENT_PROVIDERS: readonly LocalAgentProvider[] = ['claude-code', 'codex']

export type AgentCliStatus =
  | { installed: false }
  | {
      installed: true
      path: string
      version?: string
      /** null when the CLI could not say. */
      loggedIn: boolean | null
      /** The signed-in account as the CLI names it: an email, or e.g. "ChatGPT". */
      account?: string
      plan?: string
    }

const PROBE_TIMEOUT_MS = 15_000
const COMMAND: Record<LocalAgentProvider, string> = { 'claude-code': 'claude', codex: 'codex' }

function fallbackDirs(home: string): string[] {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')

    return [path.join(home, '.local', 'bin'), path.join(appData, 'npm')]
  }

  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
}

function executable(file: string): boolean {
  try {
    accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK)

    return true
  } catch {
    return false
  }
}

/** The CLI a terminal would run, falling back to the installers' default locations. */
export function findAgentCli(provider: LocalAgentProvider, env: NodeJS.ProcessEnv): string | null {
  const home = env.HOME ?? env.USERPROFILE ?? os.homedir()
  const dirs = [...(env.PATH ?? '').split(path.delimiter).filter(Boolean), ...fallbackDirs(home)]
  const names =
    process.platform === 'win32'
      ? [`${COMMAND[provider]}.exe`, `${COMMAND[provider]}.cmd`]
      : [COMMAND[provider]]

  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name)

      if (executable(file)) return file
    }
  }

  return null
}

function run(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { env, timeout: PROBE_TIMEOUT_MS, shell: file.endsWith('.cmd') },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`

        if (error && !output.trim()) reject(new Error(error.message))
        else resolve(output)
      },
    )
  })
}

export function parseClaudeAuthStatus(
  output: string,
): Pick<Extract<AgentCliStatus, { installed: true }>, 'loggedIn' | 'account' | 'plan'> {
  try {
    const parsed = JSON.parse(output) as {
      loggedIn?: unknown
      email?: unknown
      subscriptionType?: unknown
    }

    return {
      loggedIn: typeof parsed.loggedIn === 'boolean' ? parsed.loggedIn : null,
      ...(typeof parsed.email === 'string' ? { account: parsed.email } : {}),
      ...(typeof parsed.subscriptionType === 'string' ? { plan: parsed.subscriptionType } : {}),
    }
  } catch {
    return { loggedIn: null }
  }
}

/** `codex login status` prints "Logged in using ChatGPT" (or "… an API key") or "Not logged in". */
export function parseCodexLoginStatus(
  output: string,
): Pick<Extract<AgentCliStatus, { installed: true }>, 'loggedIn' | 'account'> {
  const text = output.trim()
  const loggedIn = /^Logged in using (.+)$/imu.exec(text)

  if (loggedIn?.[1]) return { loggedIn: true, account: loggedIn[1].trim() }
  if (/not logged in/iu.test(text)) return { loggedIn: false }

  return { loggedIn: null }
}

function versionOf(output: string): string | undefined {
  return output.split(/\s+/u).find((token) => /^\d+\.\d+\.\d+/u.test(token))
}

export async function probeAgentCli(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
  agentHome: string | undefined,
): Promise<AgentCliStatus> {
  const file = findAgentCli(provider, env)

  if (!file) return { installed: false }
  // Finding the executable uses the shell; checking its login uses the runtime's home.
  // Never report the shell's login if the isolated home could not be prepared.
  const runtimeEnv = agentHome
    ? agentCliEnv({ provider, env, agentHome, cliPath: file })
    : undefined
  const authArgs = provider === 'codex' ? ['login', 'status'] : ['auth', 'status', '--json']
  const parseAuth = provider === 'codex' ? parseCodexLoginStatus : parseClaudeAuthStatus
  const [version, auth] = await Promise.all([
    run(file, ['--version'], env).then(versionOf, () => undefined),
    runtimeEnv
      ? run(file, authArgs, runtimeEnv).then(parseAuth, () => ({ loggedIn: null }))
      : Promise.resolve({ loggedIn: null }),
  ])

  return { installed: true, path: file, ...(version ? { version } : {}), ...auth }
}
