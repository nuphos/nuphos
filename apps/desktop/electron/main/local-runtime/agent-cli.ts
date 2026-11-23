import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { antigravityStatus } from '../../../../runtime/image/antigravity-status.mjs'

import { readAccountKey } from './agent-account.ts'
import { appManagedCli, homeOf } from './agent-cli-apps.ts'
import { locateAgentCli } from './agent-cli-find.ts'
import { OPENCODE_AUTH_LIST, parseOpenCodeAuthList } from './agent-cli-opencode.ts'
import { CODEX_MIN_VERSION, olderThan, versionOf } from './agent-cli-version.ts'
import { claudeKeychainService } from './claude-keychain.ts'
import { agentCliEnv } from './config.ts'
import { homeLogin } from './providers.ts'

import type { LocalAgentProvider } from './providers.ts'

export { LOCAL_AGENT_PROVIDERS } from './providers.ts'
export type { LocalAgentProvider } from './providers.ts'

export function probeFailure(cli: AgentCliStatus | null) {
  return cli && !cli.installed && cli.error
    ? { cli: { installed: false, loggedIn: false, probeError: cli.error } }
    : undefined
}

export type AgentCliStatus =
  | { installed: false; error?: string }
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
      /** Which account's quota it spends, hashed (agent-account.ts); absent when unknown. */
      accountKey?: string
      /** Kept by a desktop app (Claude, ChatGPT), which updates it, even when reached through a symlink. */
      bundled?: true
    }

/** The file an installed CLI runs. */
export function cliPath(cli: AgentCliStatus | null): string | undefined {
  return cli?.installed ? cli.path : undefined
}

const PROBE_TIMEOUT_MS = 15_000

export { findAgentCli, locateAgentCli } from './agent-cli-find.ts'

export function run(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  strict = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { env, timeout: PROBE_TIMEOUT_MS, shell: file.endsWith('.cmd') },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`

        if (error && (strict || !output.trim())) reject(new Error(error.message))
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
  if (provider === 'opencode')
    return run(file, OPENCODE_AUTH_LIST, runtimeEnv).then(parseOpenCodeAuthList, () => ({
      loggedIn: true,
    }))
  const fromHome = await homeLogin(provider, agentHome)

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
    | {
        accessToken?: unknown
        refreshToken?: unknown
        subscriptionType?: unknown
        rateLimitTier?: unknown
      }
    | undefined
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
    // Claude Code stores "max" for Max 20x (now Ultra) too; only the rate limit tier tells it
    // from Max 5x. The backend's runtime-quota-probe.ts reads a remote login the same way.
    ...(typeof oauth?.subscriptionType === 'string'
      ? {
          plan:
            oauth.subscriptionType === 'max' && oauth.rateLimitTier === 'default_claude_max_20x'
              ? 'ultra'
              : oauth.subscriptionType,
        }
      : {}),
  }
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
  let dshVersion: string | undefined
  let dshUsable = false

  if (provider === 'dsh') {
    const probeEnv = runtimeEnv ?? env
    let failure = 'dsh --version printed nothing'

    try {
      const output = await run(file, ['--version'], probeEnv, true)

      dshVersion = versionOf(output)
      dshUsable = Boolean(output.trim())
    } catch {
      failure = 'dsh --version failed'
    }
    if (!dshUsable) {
      const node = await run('node', ['--version'], probeEnv, true).then(
        (output) => {
          const version = versionOf(output)

          return version ? `v${version}` : 'unavailable'
        },
        () => 'unavailable',
      )

      const outdated = olderThan(node.replace(/^v/u, ''), '24.9')

      return {
        installed: false,
        error: outdated
          ? `DeepSeek Harness couldn't start on this computer. It needs Node.js 24.9 or newer, and this computer has ${node}. Update Node.js, then try again.`
          : `DeepSeek Harness couldn't start on this computer (${failure}). Reinstall it, then try again.`,
      }
    }
  }
  const [version, auth, accountKey] = await Promise.all([
    provider === 'dsh'
      ? Promise.resolve(dshVersion)
      : run(file, ['--version'], env).then(versionOf, () => {}),
    loginOf(provider, file, runtimeEnv, agentHome),
    runtimeEnv ? readAccountKey(provider, runtimeEnv) : undefined,
  ])

  if (provider === 'codex' && version && olderThan(version, CODEX_MIN_VERSION))
    return {
      installed: false,
      error: `Codex ${version} is too old to run here. Update Codex to ${CODEX_MIN_VERSION} or newer, then try again.`,
    }

  // Usage is sampled on its own timer, never here: this probe gates the agent's
  // startup, and a provider that hangs must not hold an agent back.
  const bundled = appManagedCli(realPath(file), env)

  return {
    installed: true,
    path: file,
    ...(version ? { version } : {}),
    ...auth,
    // A key or a signed-out agent spends no account's quota.
    ...(accountKey && auth.loggedIn && !('apiKey' in auth) ? { accountKey } : {}),
    ...(bundled ? { bundled } : {}),
  }
}
