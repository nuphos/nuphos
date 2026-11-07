import type { ConversationMoveCheck } from '../../src/api/agent-types'
import type { AgentProvider } from '../../src/types/runtime'
import { AtlasHttpError, callJson, callJsonForRenderer, teamQuery } from './http'
import { importInChunks } from './transcript-import'
import { storedMessageCountFromDetails } from './transcript-window'

import type {
  AgentConversationCredentialsResponse,
  AgentCredentialOptions,
  AgentCredentialSelection,
  ConversationDetail,
  ConversationMessagesPage,
} from './types'

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
  groupId?: string,
  queuedId?: string,
): Promise<{ ok: boolean; messageId: string; text?: string }> {
  return callJson<{ ok: boolean; messageId: string; text?: string }>(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/steer${teamQuery(teamId)}`,
    { text, ...(groupId ? { groupId } : {}), ...(queuedId ? { queuedId } : {}) },
  )
}

// The secure input card: the value goes straight to a file on the agent's
// runtime and only that file's path comes back. Its failure carries the
// backend's code, which the card reads to tell an outdated runtime — a retry
// that can never work — from a failure worth trying again.
export async function saveConversationSecret(
  sessionId: string,
  name: string,
  value: string,
  teamId?: string,
): Promise<{ ok: boolean; path: string }> {
  return callJsonForRenderer<{ ok: boolean; path: string }>(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/secrets${teamQuery(teamId)}`,
    { name, value },
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
  options?: { tail?: number; runtimeState?: 'omit'; messages?: 'omit' },
): Promise<ConversationDetail> {
  const params = new URLSearchParams()

  if (teamId) params.set('teamId', teamId)
  if (options?.tail) params.set('tail', String(options.tail))
  if (options?.runtimeState) params.set('runtimeState', options.runtimeState)
  if (options?.messages) params.set('messages', options.messages)
  const q = params.toString() ? `?${String(params)}` : ''

  // Not found and forbidden reach the renderer as such, so it can tell a gone chat from an outage.
  return callJsonForRenderer<ConversationDetail>(
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

export async function updateConversationCredentials(args: {
  sessionId: string
  teamId?: string
  credentialAccess: AgentCredentialSelection
}): Promise<AgentConversationCredentialsResponse> {
  return callJson<AgentConversationCredentialsResponse>(
    'PATCH',
    `/agent/conversations/${encodeURIComponent(args.sessionId)}/credentials${teamQuery(args.teamId)}`,
    { teamId: args.teamId, credentialAccess: args.credentialAccess },
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
  import?: boolean
}): Promise<void> {
  const put = (messages: typeof args.messages, baseIndex: number | undefined) =>
    callJson<{ ok: boolean; skipped?: string; messageCount?: number }>(
      'PUT',
      `/agent/conversations/${encodeURIComponent(args.sessionId)}/transcript${teamQuery(args.teamId)}`,
      {
        title: args.title,
        agentRuntime: args.agentRuntime,
        runtimeId: args.runtimeId,
        messages,
        baseIndex: baseIndex && baseIndex > 0 ? baseIndex : undefined,
        import: args.import,
      },
    )

  // An import has no stored prefix to window against: it goes in chunks.
  if (args.import) return importInChunks(args.messages, put)
  // `messages` is already the current turn's tail (the preload windows it, see
  // transcript-window.ts); the PUT is delete-absent over the hydrated transcript.
  try {
    await put(args.messages, args.baseIndex)
  } catch (err) {
    // A rejection carrying the server's stored count: retry the same tail at that count.
    const storedCount =
      err instanceof AtlasHttpError && err.status === 409 && err.code === 'transcript_out_of_sync'
        ? storedMessageCountFromDetails(err.details)
        : undefined

    if (storedCount === undefined) throw err
    console.warn('[agent] transcript window rejected on sync; rebasing onto stored count', {
      sessionId: args.sessionId,
      storedCount,
    })
    await put(args.messages, storedCount)
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
  grantComputerUse?: boolean,
): Promise<{
  runtimeId: string
  runtimeLabel: string
  agentRuntime: AgentProvider
  mode: 'history' | 'workspace'
}> {
  return callJsonForRenderer(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/runtime${teamQuery(teamId)}`,
    { runtimeId, mode, ...(grantComputerUse ? { grantComputerUse } : {}) },
  )
}

/** Before a move: who would lose reply on the target's computer, and whether the mover can give it. */
export async function checkConversationMove(
  sessionId: string,
  teamId: string,
  runtimeId: string,
): Promise<ConversationMoveCheck> {
  const query = new URLSearchParams({ teamId, runtimeId })

  return callJsonForRenderer(
    'GET',
    `/agent/conversations/${encodeURIComponent(sessionId)}/runtime-move?${query.toString()}`,
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
