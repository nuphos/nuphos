import type { AgentProvider } from '../../src/types/runtime'
import { AtlasHttpError, callJson, callJsonForRenderer, teamQuery } from './http'
import { storedMessageCountFromDetails, windowTranscript } from './transcript-window'

import type {
  AgentConversationCredentialsResponse,
  AgentCredentialOptions,
  AgentCredentialSelection,
  ConversationDetail,
  ConversationMessagesPage,
  ConversationsPage,
} from './types'

export type ConversationsScope = 'mine' | 'team' | 'shared'
export type ConversationsArchivedFilter = 'exclude' | 'only'
export type ConversationsSort = 'activity' | 'created' | 'archived'

/**
 * teamId leads and is required — the backend rejects a listing without one, so
 * a caller that can't name the team has no question to ask. It used to trail a
 * pair of optional arguments, which is how a call site came to pass something
 * else entirely in its place.
 */
export async function listConversations(
  teamId: string,
  options?: {
    cursor?: string
    limit?: number
    // Defaults to 'mine' backend-side — the viewer's own chats in this team.
    scope?: ConversationsScope
    /** Narrow team scope to one member's conversations. */
    ownerId?: string
    /**
     * A Trigger's run history. Omitted lists Chats, which excludes trigger runs entirely — the two
     * are opposite listings, so this is never a refinement of the default. Several ids list a
     * Watch group's partition triggers together.
     */
    triggerIds?: string[]
    search?: string
    // Omitted = archived conversations list too (history); 'exclude' = sidebar.
    archived?: ConversationsArchivedFilter
    sort?: ConversationsSort
  },
): Promise<ConversationsPage> {
  const params = new URLSearchParams({ teamId })

  if (options?.cursor) params.set('cursor', options.cursor)
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.scope) params.set('scope', options.scope)
  if (options?.ownerId) params.set('ownerId', options.ownerId)
  // Sent even when empty: an empty list is a Watch group with no partitions
  // yet, and dropping the parameter would answer with Chats instead.
  if (options?.triggerIds) params.set('triggerId', options.triggerIds.join(','))
  if (options?.search) params.set('search', options.search)
  if (options?.archived) params.set('archived', options.archived)
  if (options?.sort) params.set('sort', options.sort)

  const route = `/agent/conversations?${String(params)}`

  return callJson<ConversationsPage>('GET', route, undefined, 12_000)
}

export async function setConversationArchived(
  sessionId: string,
  archived: boolean,
  teamId?: string,
): Promise<{ ok: boolean; archived: boolean }> {
  return callJson<{ ok: boolean; archived: boolean }>(
    'PATCH',
    `/agent/conversations/${encodeURIComponent(sessionId)}/archive${teamQuery(teamId)}`,
    { archived },
  )
}

export async function steerConversation(
  sessionId: string,
  text: string,
  teamId?: string,
): Promise<{ ok: boolean; messageId: string }> {
  return callJson<{ ok: boolean; messageId: string }>(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/steer${teamQuery(teamId)}`,
    { text },
  )
}

export type SlackPickupResult = {
  status: 'bound' | 'already_bound'
  slackThread: {
    workspaceId: string
    channelId: string
    threadTs: string
    url: string | null
  }
}

// "Pick up in Slack": bind this conversation to a DM thread so it can be
// continued from Slack. Idempotent — an existing binding comes back as
// 'already_bound' with its link.
export async function pickUpConversationInSlack(
  sessionId: string,
  teamId?: string,
): Promise<SlackPickupResult> {
  return callJson<SlackPickupResult>(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/slack-pickup${teamQuery(teamId)}`,
    {},
  )
}

export async function getConversation(
  sessionId: string,
  teamId?: string,
  options?: { tail?: number },
): Promise<ConversationDetail> {
  const params = new URLSearchParams()

  if (teamId) params.set('teamId', teamId)
  if (options?.tail) params.set('tail', String(options.tail))
  const q = params.toString() ? `?${String(params)}` : ''

  return callJson<ConversationDetail>(
    'GET',
    `/agent/conversations/${encodeURIComponent(sessionId)}${q}`,
  )
}

export async function getConversationMessages(
  sessionId: string,
  args: { before: number; limit?: number },
  teamId?: string,
): Promise<ConversationMessagesPage> {
  const params = new URLSearchParams()

  if (teamId) params.set('teamId', teamId)
  params.set('before', String(args.before))
  if (args.limit) params.set('limit', String(args.limit))

  return callJson<ConversationMessagesPage>(
    'GET',
    `/agent/conversations/${encodeURIComponent(sessionId)}/messages?${String(params)}`,
  )
}

export async function getCredentialOptions(teamId?: string): Promise<AgentCredentialOptions> {
  return callJson<AgentCredentialOptions>('GET', `/agent/credential-options${teamQuery(teamId)}`)
}

export type AgentStarterSuggestion = { title: string; prompt: string }

export async function getStarterSuggestions(args: {
  teamId?: string
  resources: string[]
  locale?: string
}): Promise<{ suggestions: AgentStarterSuggestion[] }> {
  return callJson<{ suggestions: AgentStarterSuggestion[] }>(
    'POST',
    `/agent/starter-suggestions${teamQuery(args.teamId)}`,
    { resources: args.resources, locale: args.locale },
  )
}

export async function updateConversationCredentials(args: {
  sessionId: string
  teamId?: string
  credentialAccess: AgentCredentialSelection
}): Promise<AgentConversationCredentialsResponse> {
  return callJson<AgentConversationCredentialsResponse>(
    'PATCH',
    `/agent/conversations/${encodeURIComponent(args.sessionId)}/credentials${teamQuery(args.teamId)}`,
    {
      teamId: args.teamId,
      credentialAccess: args.credentialAccess,
    },
  )
}

export async function syncConversationTranscript(args: {
  sessionId: string
  agentRuntime?: AgentProvider
  runtimeId?: string
  teamId?: string
  title: string
  messages: {
    id: string
    role: 'user' | 'assistant'
    parts: unknown[]
  }[]
  baseIndex?: number
}): Promise<void> {
  const put = (messages: typeof args.messages, baseIndex: number | undefined) =>
    callJson<{ ok: boolean }>(
      'PUT',
      `/agent/conversations/${encodeURIComponent(args.sessionId)}/transcript${teamQuery(args.teamId)}`,
      {
        title: args.title,
        agentRuntime: args.agentRuntime,
        runtimeId: args.runtimeId,
        messages,
        baseIndex: baseIndex && baseIndex > 0 ? baseIndex : undefined,
      },
    )
  // Same suffix-window protocol as the chat POST: the PUT has
  // delete-absent semantics over the hydrated transcript, so sending only the
  // current turn's tail is equivalent — and keeps the body from growing past
  // the ingress limit on a long live session.
  const window = windowTranscript(args.messages, args.baseIndex)

  try {
    await put(window.messages, window.baseIndex)
  } catch (err) {
    const outOfSync =
      window.dropped > 0 &&
      err instanceof AtlasHttpError &&
      err.status === 409 &&
      err.code === 'transcript_out_of_sync'

    if (!outOfSync) throw err
    // A rejection that carries the server's stored count: retry the same
    // window claiming that count as baseIndex before falling back to the
    // full transcript, which can exceed the ingress body limit.
    const storedCount = storedMessageCountFromDetails(err.details)

    if (storedCount !== undefined) {
      try {
        console.warn('[agent] transcript window rejected on sync; rebasing onto stored count', {
          sessionId: args.sessionId,
          storedCount,
        })
        await put(window.messages, storedCount)

        return
      } catch (rebaseErr) {
        const rebaseOutOfSync =
          rebaseErr instanceof AtlasHttpError &&
          rebaseErr.status === 409 &&
          rebaseErr.code === 'transcript_out_of_sync'

        if (!rebaseOutOfSync) throw rebaseErr
      }
    }
    console.warn('[agent] transcript window rejected on sync; retrying with the full transcript', {
      sessionId: args.sessionId,
    })
    await put(args.messages, args.baseIndex)
  }
}

export async function deleteConversation(sessionId: string, teamId?: string): Promise<void> {
  await callJson<{ ok: boolean }>(
    'DELETE',
    `/agent/conversations/${encodeURIComponent(sessionId)}${teamQuery(teamId)}`,
  )
}

export async function sendMessageFeedback(args: {
  sessionId: string
  messageId: string
  rating: 'up' | 'down' | null
  comment?: string
  teamId?: string
}): Promise<void> {
  await callJson<{ ok: boolean }>(
    'POST',
    `/agent/conversations/${encodeURIComponent(args.sessionId)}/messages/${encodeURIComponent(args.messageId)}/feedback${teamQuery(args.teamId)}`,
    {
      rating: args.rating,
      ...(args.comment ? { comment: args.comment } : {}),
    },
  )
}

export async function moveConversationRuntime(
  sessionId: string,
  teamId: string,
  runtimeId: string,
  mode: 'history' | 'workspace',
): Promise<{
  runtimeId: string
  runtimeLabel: string
  agentRuntime: AgentProvider
  mode: 'history' | 'workspace'
}> {
  return callJsonForRenderer(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/runtime${teamQuery(teamId)}`,
    { runtimeId, mode },
  )
}

export function cancelRuntime(
  sessionId: string,
  teamId?: string,
): Promise<{ ok: boolean; status: string }> {
  return callJson(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/cancel-runtime${teamQuery(teamId)}`,
    {},
  )
}
