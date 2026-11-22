import { spawn } from 'node:child_process'
import path from 'node:path'

import { GROK_BILLING } from '../../../../backend/src/lib/claude-code-preview/runtime-quota-grok-billing.ts'

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

async function claudeUsageRequest(
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<UsageRequest | null> {
  const credential = await readClaudeCredential(home, env)
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

/** Grok answers its own ACP `_x.ai/billing`, run in the agent's home so it reads
 *  the account this agent signed in to — the same program the cloud runtime's
 *  usage probe runs. */
function readGrokUsage(env: NodeJS.ProcessEnv): Promise<unknown> {
  const program = `${GROK_BILLING}
process.stdout.write(JSON.stringify(await grokBilling(process.env.NUPHOS_AGENT_EXECUTABLE || 'grok')))`

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let output = ''

    child.on('error', () => resolve(undefined))
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (output.length > MAX_USAGE_CHARS) child.kill()
    })
    child.on('close', () => {
      try {
        const answer = JSON.parse(output) as unknown

        resolve(answer && typeof answer === 'object' && !('error' in answer) ? answer : undefined)
      } catch {
        resolve(undefined)
      }
    })
  })
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
  if (provider === 'grok') return readGrokUsage(env)
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
