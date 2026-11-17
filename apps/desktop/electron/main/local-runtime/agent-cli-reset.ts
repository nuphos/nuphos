import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { homeOf } from './agent-cli-apps.ts'
import { readJson } from './agent-cli.ts'
import { CLAUDE_USAGE_URL, claudeRequestHeaders } from './agent-cli-usage.ts'

const RESET_TIMEOUT_MS = 25_000
const RESULTS = ['reset', 'already_used', 'not_limited', 'cooldown', 'ineligible'] as const

export type ClaudeResetOutcome =
  | { result: 'reset'; resetsLeft: number | null }
  | { result: Exclude<(typeof RESULTS)[number], 'reset'> | 'unavailable' }

type Grant = {
  id?: unknown
  resets_left?: unknown
  ends_at?: unknown
  usable_now?: unknown
  paused?: unknown
}

const endsAt = (grant: Grant) =>
  typeof grant.ends_at === 'string' ? Date.parse(grant.ends_at) || Infinity : Infinity

/** The grant Claude Code's own `/limit-reset` would spend: usable now, not paused,
 *  and the first to expire. */
function usableGrant(usage: unknown): string | undefined {
  const grants = (usage as { cedar_ember?: { grants?: unknown } } | null)?.cedar_ember?.grants

  if (!Array.isArray(grants)) return
  const [first] = (grants as Grant[])
    .filter(
      (grant) =>
        typeof grant.id === 'string' &&
        typeof grant.resets_left === 'number' &&
        grant.resets_left > 0 &&
        grant.usable_now === true &&
        grant.paused !== true,
    )
    .sort((a, b) => endsAt(a) - endsAt(b))

  return first?.id as string | undefined
}

/** Spends one of this computer's Claude limit resets, the way Claude Code's hidden
 *  `/limit-reset` does. It cannot be undone, so it runs only when the owner confirms
 *  it here; the grant is read again first, and nothing is sent without one usable
 *  now. Every failure is `unavailable`: the endpoints are private and may change. */
export async function spendClaudeReset(
  env: NodeJS.ProcessEnv,
  version?: string,
): Promise<ClaudeResetOutcome> {
  const unavailable = { result: 'unavailable' } as const

  try {
    const headers = await claudeRequestHeaders(env, version)
    const dir = env.CLAUDE_CONFIG_DIR ?? homeOf(env)
    const account = (await readJson(path.join(dir, '.claude.json')))?.oauthAccount as
      { organizationUuid?: unknown } | undefined
    const org = account?.organizationUuid

    if (!headers || typeof org !== 'string' || !/^[\w-]{1,80}$/u.test(org)) return unavailable
    const signal = AbortSignal.timeout(RESET_TIMEOUT_MS)
    const read = await fetch(CLAUDE_USAGE_URL, { headers, signal })
    const grant = read.ok ? usableGrant(await read.json()) : undefined

    if (!grant) return unavailable
    const response = await fetch(
      `https://api.anthropic.com/api/organizations/${org}/reset_rate_limits`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ program: 'cedar_ember', grant_id: grant, request_id: randomUUID() }),
        signal,
      },
    )

    if (!response.ok) return unavailable
    const answer = (await response.json()) as { result?: unknown; resets_left?: unknown }
    const result = RESULTS.find((known) => known === answer.result)

    if (result === 'reset')
      return {
        result,
        resetsLeft: typeof answer.resets_left === 'number' ? answer.resets_left : null,
      }

    return result ? { result } : unavailable
  } catch {
    return unavailable
  }
}
