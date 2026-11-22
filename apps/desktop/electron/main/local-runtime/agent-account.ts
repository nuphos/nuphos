import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { homeOf } from './agent-cli-apps.ts'

import type { LocalAgentProvider } from './providers.ts'

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** The claims in a JWT, read without checking it: they only name an account. */
function jwtClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null
  try {
    return JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>
  } catch {
    return null
  }
}

/** One login can sit in several organizations, each with its own plan, so the
 *  organization names the quota too. */
async function claudeAccountId(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const config = await readJson(path.join(env.CLAUDE_CONFIG_DIR ?? homeOf(env), '.claude.json'))
  const { accountUuid: account, organizationUuid: org } = (config?.oauthAccount ?? {}) as {
    accountUuid?: unknown
    organizationUuid?: unknown
  }

  return typeof account === 'string' && account && typeof org === 'string' && org
    ? `${account}:${org}`
    : undefined
}

/** A ChatGPT workspace is shared by its members, so its user names the quota too. */
async function codexAccountId(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const dir = env.CODEX_HOME ?? path.join(homeOf(env), '.codex')
  const auth = await readJson(path.join(dir, 'auth.json'))
  const claims = jwtClaims((auth?.tokens as { id_token?: unknown } | undefined)?.id_token)
  const openai = claims?.['https://api.openai.com/auth'] as
    { chatgpt_account_id?: unknown; chatgpt_user_id?: unknown } | undefined
  const { chatgpt_account_id: workspace, chatgpt_user_id: user } = openai ?? {}

  return typeof workspace === 'string' && workspace && typeof user === 'string' && user
    ? `${workspace}:${user}`
    : undefined
}

/** The signed-in account's own id, one quota per id. */
const ACCOUNT_ID: Partial<
  Record<LocalAgentProvider, (env: NodeJS.ProcessEnv) => Promise<string | undefined>>
> = { 'claude-code': claudeAccountId, codex: codexAccountId }

/** Names the account without saying whose it is, so the team can see which agents
 *  share one quota. The id itself never leaves this computer. */
export async function readAccountKey(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const id = await ACCOUNT_ID[provider]?.(env)

  return id && createHash('sha256').update(`${provider}:${id}`).digest('hex').slice(0, 20)
}
