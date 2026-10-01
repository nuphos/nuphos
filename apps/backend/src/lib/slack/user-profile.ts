import { logError } from '@/lib/observability'

import { slackApiGet } from './api'

type CacheEntry = { name: string | null; expiresAt: number }

const userNameCache = new Map<string, CacheEntry>()
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000

// A missing scope or a transient Slack failure can be repaired by reinstalling
// the app. Do not pin that failure for the six-hour success TTL.
export const SLACK_USER_NAME_FAILURE_TTL_MS = 30_000
const MAX_ENTRIES = 5000

function setCacheEntry(key: string, entry: CacheEntry, now: number): void {
  if (userNameCache.size >= MAX_ENTRIES) {
    for (const [cachedKey, cached] of userNameCache) {
      if (cached.expiresAt <= now) userNameCache.delete(cachedKey)
    }
    while (userNameCache.size >= MAX_ENTRIES) {
      const oldest = userNameCache.keys().next().value

      if (oldest === undefined) break
      userNameCache.delete(oldest)
    }
  }
  userNameCache.set(key, entry)
}

export async function fetchSlackUserName(
  botToken: string,
  slackWorkspaceId: string,
  slackUserId: string,
  dependencies: { apiGet?: typeof slackApiGet; now?: () => number } = {},
): Promise<string | null> {
  const now = dependencies.now?.() ?? Date.now()
  const key = `${slackWorkspaceId}:${slackUserId}`
  const cached = userNameCache.get(key)

  if (cached && cached.expiresAt > now) return cached.name

  let name: string | null = null

  try {
    const json = await (dependencies.apiGet ?? slackApiGet)(botToken, 'users.info', {
      user: slackUserId,
    })
    const user = json.user

    if (user && typeof user === 'object') {
      name =
        user.profile?.display_name?.trim() ||
        user.profile?.real_name?.trim() ||
        user.real_name?.trim() ||
        user.name?.trim() ||
        null
    }
  } catch (err) {
    logError('slack.agent.users_info.error', err, { slack_user_id: slackUserId })
  }

  setCacheEntry(
    key,
    {
      name,
      expiresAt: now + (name ? SUCCESS_TTL_MS : SLACK_USER_NAME_FAILURE_TTL_MS),
    },
    now,
  )

  return name
}

/** Test-only cache reset; exported to keep time-based tests deterministic. */
export function clearSlackUserNameCache(): void {
  userNameCache.clear()
}
