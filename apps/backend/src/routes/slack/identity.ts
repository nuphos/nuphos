import { getTeamMembers } from '@/lib/identity'
import { logError, logEvent } from '@/lib/observability'
import { getSlackUserMapping, upsertSlackUserMapping } from '@/lib/slack/agent-bot'
import { slackApiGet } from '@/lib/slack/api'

import type { SlackUserMapping } from '@/lib/slack/agent-bot'

async function fetchSlackUserEmail(botToken: string, slackUserId: string): Promise<string | null> {
  try {
    const json = await slackApiGet(botToken, 'users.info', { user: slackUserId })
    const user = json.user
    const email =
      user && typeof user === 'object' && user.profile?.email ? user.profile.email : undefined

    return email ? email.trim().toLowerCase() : null
  } catch (err) {
    logError('slack.agent.users_info.error', err, { slack_user_id: slackUserId })

    return null
  }
}

// In-memory display-name caches for rendering human-readable transcripts —
// raw <@U…>/<#C…> ids only render as names inside Slack itself, so the
// persisted turn text resolves them to real names. Names change rarely; a
// cold miss costs one Tier-4 info call. Lookup failures cache null so a
// broken lookup cannot add an API call per message.
const slackChannelNameCache = new Map<string, { name: string | null; expiresAt: number }>()
const SLACK_NAME_CACHE_TTL_MS = 6 * 60 * 60 * 1000
// Bound the caches for a long-running multi-workspace process: expired
// entries are only skipped on read, so without eviction they pile up forever.
const SLACK_NAME_CACHE_MAX_ENTRIES = 5000

function setNameCacheEntry(
  cache: Map<string, { name: string | null; expiresAt: number }>,
  key: string,
  entry: { name: string | null; expiresAt: number },
): void {
  if (cache.size >= SLACK_NAME_CACHE_MAX_ENTRIES) {
    const now = Date.now()

    for (const [cachedKey, cached] of cache) {
      if (cached.expiresAt <= now) cache.delete(cachedKey)
    }
    // Still full after sweeping expired entries: drop the oldest-inserted.
    while (cache.size >= SLACK_NAME_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value

      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }
  cache.set(key, entry)
}

export async function fetchSlackChannelName(
  botToken: string,
  slackWorkspaceId: string,
  channelId: string,
): Promise<string | null> {
  const key = `${slackWorkspaceId}:${channelId}`
  const cached = slackChannelNameCache.get(key)

  if (cached && cached.expiresAt > Date.now()) return cached.name
  let name: string | null = null

  try {
    const json = await slackApiGet(botToken, 'conversations.info', { channel: channelId })
    const channel = json.channel

    if (channel && typeof channel === 'object' && channel.name?.trim()) {
      name = channel.name.trim()
    }
  } catch (err) {
    logError('slack.agent.conversations_info.error', err, { slack_channel_id: channelId })
  }
  setNameCacheEntry(slackChannelNameCache, key, {
    name,
    expiresAt: Date.now() + SLACK_NAME_CACHE_TTL_MS,
  })

  return name
}

export async function resolveSlackUserMapping(
  slackWorkspaceId: string,
  teamId: string,
  slackUserId: string,
  botToken: string,
): Promise<{ mapping: SlackUserMapping | null; email: string | null }> {
  const existing = await getSlackUserMapping(slackWorkspaceId, teamId, slackUserId)

  if (existing) return { mapping: existing, email: null }

  const email = await fetchSlackUserEmail(botToken, slackUserId)

  if (!email) return { mapping: null, email: null }

  const members = await getTeamMembers(teamId)
  const match = members.find((member) => member.email.trim().toLowerCase() === email)

  if (!match) return { mapping: null, email }

  const mapping = await upsertSlackUserMapping({
    slackWorkspaceId,
    slackUserId,
    teamId,
    nuphosUserId: match.id,
    createdBy: 'auto:slack-email',
  })

  logEvent('info', 'slack.agent.user_mapping.auto_link', {
    team_id: teamId,
    slack_workspace_id: slackWorkspaceId,
    slack_user_id: slackUserId,
    nuphos_user_id: match.id,
  })

  return { mapping, email }
}
