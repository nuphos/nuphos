import { spawn } from 'node:child_process'
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

/** Grok keeps its credential to itself and answers its own ACP `_x.ai/billing`,
 *  as the cloud runtime's probe asks it. Run in the agent's home, so it reads the
 *  account this agent signed in to. */
function readGrokUsage(env: NodeJS.ProcessEnv): Promise<unknown> {
  return new Promise((resolve) => {
    const child = spawn(env.NUPHOS_AGENT_EXECUTABLE || 'grok', ['agent', '--no-leader', 'stdio'], {
      env: { ...env, GROK_DISABLE_AUTOUPDATER: '1' },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const done = (usage?: unknown) => {
      clearTimeout(timer)
      child.kill()
      resolve(usage)
    }
    const timer = setTimeout(done, USAGE_TIMEOUT_MS)
    const send = (message: object) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
    let buffer = ''

    child.on('error', () => done())
    child.stdin.on('error', () => done())
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      if (buffer.length > MAX_USAGE_CHARS) return done()
      for (let end; (end = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(end + 1)) {
        let message: { id?: unknown; result?: unknown }

        try {
          message = JSON.parse(buffer.slice(0, end)) as typeof message
        } catch {
          continue
        }
        if (message.id === 1) send({ id: 2, method: '_x.ai/billing', params: {} })
        if (message.id === 2) done(message.result ?? undefined)
      }
    })
    send({ id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } })
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
