import { config } from '@/config'
import { normalizeConversationActivitySource } from '@/lib/agent/conversation-activity-source'
import { normalizeConversationTriggerRun } from '@/lib/agent/conversation-trigger-run'
import { canManage, canReply, conversationAccess, generalAccessOf } from '@/lib/agent/db/access'
import { conversationReadState } from '@/lib/agent/db/read-state'
import { fetchCachedUsers } from '@/lib/agent/directory'
import { runtimeProvider } from '@/lib/claude-code-preview/runtime-provider'
import { getTeamMembers } from '@/lib/identity'
import { logError, logEvent } from '@/lib/observability'

import { serializeConversationDoc } from './transcript'

import type { AgentConversation } from '@/lib/agent/db'
import type { NuphosUser } from '@/lib/identity'
import type { SlackAgentThread } from '@/lib/slack/agent-bot'

export type ConversationOwner = Pick<NuphosUser, 'id' | 'name' | 'email' | 'avatarURL'> & {
  // Former member (removed from the team, or account deleted). Clients render
  // these dimmed with a "Deactivated" tag.
  deactivated?: boolean
}

type SlackThreadLink = {
  workspaceId: string
  channelId: string
  threadTs: string
  url: string | null
}

type SlackPermalinkResponse = {
  ok: boolean
  permalink?: string
  error?: string
}

async function getSlackPermalink(channelId: string, threadTs: string): Promise<string | null> {
  const token = config.slack.botToken

  if (!token) return null

  try {
    const url = new URL('https://slack.com/api/chat.getPermalink')

    url.searchParams.set('channel', channelId)
    url.searchParams.set('message_ts', threadTs)
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
      headers: {
        authorization: `Bearer ${token}`,
      },
    })
    const json = (await response.json()) as SlackPermalinkResponse

    if (!response.ok || !json.ok) {
      logEvent('warn', 'slack.agent.permalink.failed', {
        slack_channel_id: channelId,
        slack_thread_ts: threadTs,
        slack_error: json.error ?? `HTTP ${String(response.status)}`,
      })

      return null
    }

    return json.permalink ?? null
  } catch (err) {
    logError('slack.agent.permalink.error', err, {
      slack_channel_id: channelId,
      slack_thread_ts: threadTs,
    })

    return null
  }
}

function buildSlackThreadFallbackUrl(
  workspaceId: string,
  channelId: string,
  threadTs: string,
): string {
  return `https://app.slack.com/client/${encodeURIComponent(workspaceId)}/${encodeURIComponent(channelId)}/thread/${encodeURIComponent(channelId)}-${encodeURIComponent(threadTs)}`
}

export async function buildSlackThreadLink(
  thread: SlackAgentThread | null,
): Promise<SlackThreadLink | null> {
  if (!thread) return null
  const permalink = await getSlackPermalink(thread.slackChannelId, thread.slackThreadTs)

  return {
    workspaceId: thread.slackWorkspaceId,
    channelId: thread.slackChannelId,
    threadTs: thread.slackThreadTs,
    url:
      permalink ??
      buildSlackThreadFallbackUrl(
        thread.slackWorkspaceId,
        thread.slackChannelId,
        thread.slackThreadTs,
      ),
  }
}

export async function buildConversationOwnerMap(
  teamId: string | undefined,
  userIds: readonly string[],
): Promise<Map<string, ConversationOwner>> {
  const ownerById = new Map<string, ConversationOwner>()

  if (teamId) {
    // Removed members still own their old conversations — attribute those by
    // name (tagged as deactivated) instead of "Unknown user".
    const members = await getTeamMembers(teamId, { includeRemoved: true })

    for (const member of members) {
      // A re-added user has both a tombstoned and an active entry; the active
      // one must win regardless of array order.
      if (member.removedAt && ownerById.has(member.id)) continue
      ownerById.set(member.id, {
        id: member.id,
        name: member.removedAt ? member.username || member.name : member.name,
        email: member.email,
        avatarURL: member.avatarURL,
        ...(member.removedAt ? { deactivated: true } : {}),
      })
    }
  }

  const missingUserIds = Array.from(new Set(userIds.filter((id) => id && !ownerById.has(id))))

  if (missingUserIds.length > 0) {
    const cachedUsers = await fetchCachedUsers(missingUserIds)

    for (const userId of missingUserIds) {
      const cachedUser = cachedUsers[userId]

      if (!cachedUser) continue
      // In team scope anyone resolved via the directory cache is no longer a
      // team member (e.g. their account was deleted outright), so tag them too.
      const cachedName = cachedUser.username || cachedUser.name

      ownerById.set(userId, {
        id: userId,
        name:
          teamId && cachedName
            ? cachedName
            : cachedUser.name || cachedUser.username || 'Unknown user',
        email: '',
        avatarURL: cachedUser.avatarURL,
        ...(teamId ? { deactivated: true } : {}),
      })
    }
  }

  return ownerById
}

export function serializeConversationForViewer(
  conversation: Record<string, unknown> & { userId: string },
  viewer: NuphosUser,
  ownerById: Map<string, ConversationOwner>,
  slackThread?: Pick<SlackAgentThread, 'origin'> | null,
) {
  const isOwner = conversation.userId === viewer.id
  const grants = conversation as unknown as AgentConversation
  const access = conversationAccess(grants, viewer.id)
  const owner =
    ownerById.get(conversation.userId) ??
    (isOwner
      ? {
          id: viewer.id,
          name: viewer.name,
          email: viewer.email,
          avatarURL: viewer.avatarURL,
        }
      : {
          id: conversation.userId,
          name: 'Unknown user',
          email: '',
          avatarURL: '',
        })

  const metadata =
    conversation.metadata && typeof conversation.metadata === 'object'
      ? (conversation.metadata as Record<string, unknown>)
      : undefined
  const triggerRun = normalizeConversationTriggerRun(metadata)

  return {
    ...serializeConversationDoc(conversation),
    claudeCodeRuntimeAttached: true,
    agentRuntime: runtimeProvider(conversation.agentRuntime),
    runtimeId: conversation.runtimeId,
    runtimeLabel: conversation.runtimeLabel,
    activitySource: normalizeConversationActivitySource(
      typeof metadata?.source === 'string' ? metadata.source : undefined,
      slackThread,
    ),
    ...(triggerRun ? { triggerRun } : {}),
    owner,
    isOwner,
    // What this viewer may do; the list and detail routes only return what
    // they may at least read, so null here means a personal conversation.
    access,
    generalAccess: generalAccessOf(grants),
    readOnly: !canReply(access),
    // May move the session to another runtime and change its credentials.
    canManage: canManage(access),
    ...(isOwner
      ? conversationReadState(conversation)
      : { activitySeq: undefined, readSeq: undefined, unread: false }),
  }
}
