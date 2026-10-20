import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { appManagedCli, homeOf } from './agent-cli-apps.ts'
import { locateAgentCli } from './agent-cli-find.ts'
import { claudeKeychainService } from './claude-keychain.ts'
import { agentCliEnv } from './config.ts'
import { homeLogin } from './providers.ts'

import type { LocalAgentProvider } from './providers.ts'

export { LOCAL_AGENT_PROVIDERS } from './providers.ts'
export type { LocalAgentProvider } from './providers.ts'

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
      /** Kept by a desktop app (Claude, ChatGPT), which updates it, even when reached through a symlink. */
      bundled?: true
    }

const PROBE_TIMEOUT_MS = 15_000
const USAGE_TIMEOUT_MS = 10_000
const MAX_USAGE_CHARS = 200_000

export { findAgentCli, locateAgentCli } from './agent-cli-find.ts'

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

/** The agent's login in its isolated home; never the shell's, so null without that home. */
async function loginOf(
  provider: LocalAgentProvider,
  file: string,
  runtimeEnv: NodeJS.ProcessEnv | undefined,
  agentHome: string | undefined,
): Promise<Partial<AgentCliStatus> & { loggedIn: boolean | null }> {
  if (!runtimeEnv || !agentHome) return { loggedIn: null }
  const fromHome = await homeLogin(provider, agentHome)

  if (fromHome !== undefined) return { loggedIn: fromHome }
  const codex = provider === 'codex'

  return run(file, codex ? ['login', 'status'] : ['auth', 'status', '--json'], runtimeEnv).then(
    async (output) => {
      if (codex) return parseCodexLoginStatus(output)
      const auth = parseClaudeAuthStatus(output)

      return auth.loggedIn && (await claudeTokensGone(runtimeEnv))
        ? { ...auth, loggedIn: false }
        : auth
    },
    () => ({ loggedIn: null }),
  )
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

/**
 * Claude Code still reports a credentials file whose tokens are gone as signed in, though no
 * turn can authenticate with it. Where that file is the login, it is read as the agent would.
 */
async function claudeTokensGone(env: NodeJS.ProcessEnv): Promise<boolean> {
  if (process.platform === 'darwin' || !env.CLAUDE_CONFIG_DIR) return false
  const credential = await readJson(path.join(env.CLAUDE_CONFIG_DIR, '.credentials.json'))
  const oauth = credential?.claudeAiOauth as
    { accessToken?: unknown; refreshToken?: unknown } | undefined

  return oauth !== undefined && !oauth.accessToken && !oauth.refreshToken
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
  let credential = await readJson(path.join(dir, '.credentials.json'))

  // Match Claude's Keychain selection, including the terminal's unsuffixed default entry.
  // Claude keys the entry by account too; without it a stale entry of the same name can win.
  if (process.platform === 'darwin' && env.CLAUDE_CONFIG_DIR) {
    try {
      credential = JSON.parse(
        await run(
          '/usr/bin/security',
          [
            'find-generic-password',
            '-a',
            os.userInfo().username,
            '-s',
            claudeKeychainService(env),
            '-w',
          ],
          env,
        ),
      ) as Record<string, unknown>
    } catch {
      // Linux and file-backed sign-ins still use .credentials.json.
    }
  }
  const oauth = credential?.claudeAiOauth as { accessToken?: unknown } | undefined

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
  const home = homeOf(env)

  if (provider === 'codex') return codexUsageRequest(home, env)
  if (provider === 'claude-code') return claudeUsageRequest(home, env)

  return Promise.resolve(null)
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

/** A Store app's command alias is a reparse point that realpath cannot always follow. */
function realPath(file: string): string {
  try {
    return realpathSync(file)
  } catch {
    return file
  }
}

export async function probeAgentCli(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
  agentHome: string | undefined,
): Promise<AgentCliStatus> {
  const file = await locateAgentCli(provider, env)

  if (!file) return { installed: false }
  // Finding the executable uses the shell; checking its login uses the runtime's home.
  // Never report the shell's login if the isolated home could not be prepared.
  const runtimeEnv = agentHome
    ? agentCliEnv({ provider, env, agentHome, cliPath: file })
    : undefined
  const [version, auth] = await Promise.all([
    run(file, ['--version'], env).then(versionOf, () => {}),
    loginOf(provider, file, runtimeEnv, agentHome),
  ])

  // Usage is sampled on its own timer, never here: this probe gates the agent's
  // startup, and a provider that hangs must not hold an agent back.
  const bundled = appManagedCli(realPath(file), env)

  return {
    installed: true,
    path: file,
    ...(version ? { version } : {}),
    ...auth,
    ...(bundled ? { bundled } : {}),
  }
}
