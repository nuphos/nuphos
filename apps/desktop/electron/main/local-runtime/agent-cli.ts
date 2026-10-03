import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { readFile } from 'node:fs/promises'
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
const USAGE_TIMEOUT_MS = 10_000
const MAX_USAGE_CHARS = 200_000
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

type UsageRequest = { url: string; headers: Record<string, string> }

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

async function codexUsageRequest(
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<UsageRequest | null> {
  const auth = await readJson(path.join(env.CODEX_HOME ?? path.join(home, '.codex'), 'auth.json'))
  const tokens = auth?.tokens as { access_token?: unknown; account_id?: unknown } | undefined

  if (typeof tokens?.access_token !== 'string' || !tokens.access_token) return null
  const account = typeof tokens.account_id === 'string' ? tokens.account_id : ''

  return {
    url: 'https://chatgpt.com/backend-api/wham/usage',
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      ...(account ? { 'chatgpt-account-id': account } : {}),
    },
  }
}

async function claudeUsageRequest(
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<UsageRequest | null> {
  const dir = env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude')
  const oauth = (await readJson(path.join(dir, '.credentials.json')))?.claudeAiOauth as
    { accessToken?: unknown } | undefined

  if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) return null

  return {
    url: 'https://api.anthropic.com/api/oauth/usage',
    headers: {
      authorization: `Bearer ${oauth.accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
    },
  }
}

/** Where this computer keeps the credential, and what the provider wants to see
 *  with it. Null when nothing is signed in. */
function usageRequest(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
): Promise<UsageRequest | null> {
  const home = env.HOME ?? env.USERPROFILE ?? os.homedir()

  return provider === 'codex' ? codexUsageRequest(home, env) : claudeUsageRequest(home, env)
}

/** Asks the provider what is left of this computer's own account. It runs here,
 *  not in Nuphos, because the credential is here — and because the rate limit it
 *  spends is this person's, not a shared one. Every failure reports nothing:
 *  usage is decoration, never a reason to call the agent broken, and the token
 *  must never reach a log. */
export async function readAgentUsage(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  const request = await usageRequest(provider, env)

  if (!request) return
  try {
    const response = await fetch(request.url, {
      headers: request.headers,
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    })

    if (!response.ok) return
    const body = await response.text()

    if (body.length > MAX_USAGE_CHARS) return

    return JSON.parse(body) as unknown
  } catch {
    return
  }
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

  // Usage is sampled on its own timer, never here: this probe gates the agent's
  // startup, and a provider that hangs must not hold an agent back.
  return { installed: true, path: file, ...(version ? { version } : {}), ...auth }
}
