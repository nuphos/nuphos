import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { antigravityStatus } from '../../../../runtime/image/antigravity-status.mjs'

import { appManagedCli, homeOf } from './agent-cli-apps.ts'
import { locateAgentCli } from './agent-cli-find.ts'
import { OPENCODE_AUTH_LIST, parseOpenCodeAuthList } from './agent-cli-opencode.ts'
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
      /** Signed in with an API key rather than an account. The key itself never leaves the CLI. */
      apiKey?: true
      /** The host of the user's own model provider, which stands in for a sign-in. */
      customProvider?: string
      plan?: string
      /** Kept by a desktop app (Claude, ChatGPT), which updates it, even when reached through a symlink. */
      bundled?: true
    }

const PROBE_TIMEOUT_MS = 15_000

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

/**
 * `codex login status` prints "Logged in using ChatGPT", "Not logged in", and for a key
 * "API key configured" (older CLIs: "Logged in using an API key").
 */
export function parseCodexLoginStatus(
  output: string,
): Pick<Extract<AgentCliStatus, { installed: true }>, 'loggedIn' | 'account' | 'apiKey'> {
  const text = output.trim()
  const loggedIn = /^Logged in using (.+)$/imu.exec(text)

  // It goes on to print part of the key, which is not shown anywhere.
  if (/^(Logged in using an API key|API key configured)/imu.test(text))
    return { loggedIn: true, apiKey: true }
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
  if (provider === 'antigravity') return { loggedIn: await antigravityStatus(file, runtimeEnv) }
  const fromHome = await homeLogin(provider, agentHome)

  if (fromHome === false && provider === 'opencode')
    return run(file, OPENCODE_AUTH_LIST, runtimeEnv).then(parseOpenCodeAuthList, () => ({
      loggedIn: false,
    }))
  if (fromHome !== undefined) return { loggedIn: fromHome }
  if (provider === 'claude-code') return claudeLogin(runtimeEnv)

  return run(file, ['login', 'status'], runtimeEnv).then(parseCodexLoginStatus, () => ({
    loggedIn: null,
  }))
}

/**
 * Read from the credential, never from `claude auth status`: that command refreshes an
 * expired token and exits before saving the rotated one, so the next refresh is refused
 * and Claude Code clears the sign-in.
 */
async function claudeLogin(
  env: NodeJS.ProcessEnv,
): Promise<Partial<AgentCliStatus> & { loggedIn: boolean | null }> {
  const oauth = (await readClaudeCredential(homeOf(env), env))?.claudeAiOauth as
    { accessToken?: unknown; refreshToken?: unknown; subscriptionType?: unknown } | undefined
  const config = env.CLAUDE_CONFIG_DIR
    ? await readJson(path.join(env.CLAUDE_CONFIG_DIR, '.claude.json'))
    : null
  const email = (config?.oauthAccount as { emailAddress?: unknown } | undefined)?.emailAddress
  // A key in its own settings outranks the account sign-in (claude-login.mjs puts it there).
  const settings = env.CLAUDE_CONFIG_DIR
    ? await readJson(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json'))
    : null
  const key = (settings?.env as { ANTHROPIC_API_KEY?: unknown } | undefined)?.ANTHROPIC_API_KEY

  if (typeof key === 'string' && key) return { loggedIn: true, apiKey: true }

  return {
    loggedIn: Boolean(oauth?.accessToken || oauth?.refreshToken),
    ...(typeof email === 'string' ? { account: email } : {}),
    ...(typeof oauth?.subscriptionType === 'string' ? { plan: oauth.subscriptionType } : {}),
  }
}

/** OpenCode 2.x prints "opencode v2.1.4"; the others print the bare version. */
function versionOf(output: string): string | undefined {
  return output
    .split(/\s+/u)
    .find((token) => /^v?\d+\.\d+\.\d+/u.test(token))
    ?.replace(/^v/u, '')
}

export async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** The Claude credential its sign-in and its usage both read, where Claude Code keeps it. */
export async function readClaudeCredential(
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown> | null> {
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

  return credential
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
