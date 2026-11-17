import { access } from 'node:fs/promises'
import path from 'node:path'

import { homeOf } from './agent-cli-apps.ts'
import { readClaudeCredential, readJson } from './agent-cli.ts'

import type { LocalAgentProvider } from './providers.ts'

const USAGE_TIMEOUT_MS = 10_000
const MAX_USAGE_CHARS = 200_000

type UsageRequest = { url: string; headers: Record<string, string> }

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

/** The agent's own opt-in to limit resets, kept beside its Claude sign-in. Off by
 *  default: reading them means asking an unofficial Anthropic API as Claude Code. */
export function claudeResetsMarker(env: NodeJS.ProcessEnv): string {
  return path.join(
    env.CLAUDE_CONFIG_DIR ?? path.join(homeOf(env), '.claude'),
    '.nuphos-limit-resets',
  )
}

export const claudeResetsOn = (env: NodeJS.ProcessEnv) =>
  access(claudeResetsMarker(env)).then(
    () => true,
    () => false,
  )

/** Claude Code's sign-in, and the headers Anthropic expects with it. Anthropic lists
 *  limit resets (`cedar_ember`) only to Claude Code itself, so an opted-in request says
 *  it is one, with the version installed here. Null when nothing is signed in. */
export async function claudeRequestHeaders(
  env: NodeJS.ProcessEnv,
  version: string | undefined,
  asClaudeCode: boolean,
): Promise<Record<string, string> | null> {
  const credential = await readClaudeCredential(homeOf(env), env)
  const oauth = credential?.claudeAiOauth as { accessToken?: unknown } | undefined

  if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) return null

  return {
    authorization: `Bearer ${oauth.accessToken}`,
    'anthropic-beta': 'oauth-2025-04-20',
    ...(asClaudeCode
      ? { 'user-agent': `claude-cli/${version ?? '2.1.322'} (external, cli)`, 'x-app': 'cli' }
      : {}),
  }
}

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

export const CLAUDE_RESETS_URL = `${CLAUDE_USAGE_URL}?cedar_ember=1`

async function claudeUsageRequest(
  env: NodeJS.ProcessEnv,
  version: string | undefined,
): Promise<UsageRequest | null> {
  const resets = await claudeResetsOn(env)
  const headers = await claudeRequestHeaders(env, version, resets)

  return headers && { url: resets ? CLAUDE_RESETS_URL : CLAUDE_USAGE_URL, headers }
}

/** Where this computer keeps the credential, and what the provider wants to see
 *  with it. Null when nothing is signed in. */
function usageRequest(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
  version: string | undefined,
): Promise<UsageRequest | null> {
  if (provider === 'codex') return codexUsageRequest(homeOf(env), env)
  if (provider === 'claude-code') return claudeUsageRequest(env, version)

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
  version?: string,
): Promise<unknown> {
  const request = await usageRequest(provider, env, version)

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
