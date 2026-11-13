// A question that asks for a connector is answered by selecting it: whoever
// selects it (the user in the picker, a parent agent's grant), the question
// leaves the Inbox and the agent that asked is told to continue.
import { randomUUID } from 'node:crypto'

import { logError, logEvent } from '@/lib/observability'

import { getConversationBySessionId } from './db'
import { openInputRequests, resolveInputRequest } from './db/pending-decision'
import { systemSender } from './message-metadata'
import { CONNECTABLE_PROVIDERS, isConnectableProvider } from './tools-skilled/decision-tools'

import type { AgentCredentialAccess } from './db'
import type { InputRequest } from './db/pending-decision'
import type { SelectionKey } from '@/lib/claude-code-preview/credential-lister'

export type AddedCredentialIds = Partial<Record<SelectionKey, string[]>>

/** The ids each selection field has in `after` and did not have in `before`. */
export function addedCredentialIds(
  before: Partial<AgentCredentialAccess> | undefined,
  after: Partial<AgentCredentialAccess>,
): AddedCredentialIds {
  const added: AddedCredentialIds = {}

  for (const [key, ids] of Object.entries(after)) {
    if (!Array.isArray(ids)) continue
    const had = new Set(before?.[key as SelectionKey] ?? [])
    const fresh = ids.filter((id: string) => !had.has(id))

    if (fresh.length) added[key as SelectionKey] = fresh
  }

  return added
}

/** The providers of `request` that `added` selects; a personal credential's id is its provider. */
export function selectedProviders(request: InputRequest, added: AddedCredentialIds): string[] {
  // An exact own credential is answered only by selecting it, never by a team binding.
  if (request.credentials?.length) {
    return request.credentials
      .filter((ref) => added.personalCredentialIds?.includes(ref.id))
      .map((ref) => `${ref.provider} ${ref.id}`)
  }

  return (request.providers ?? []).filter((provider) => {
    const key = isConnectableProvider(provider) ? CONNECTABLE_PROVIDERS[provider] : undefined

    return Boolean((key && added[key]?.length) || added.personalCredentialIds?.includes(provider))
  })
}

/**
 * Answers the conversation's open questions that `added` selects a provider of,
 * then starts a turn that tells the agent so. Best-effort: the selection is
 * already saved, and a question left open can still be answered by hand.
 */
export async function answerCredentialAsks(sessionId: string, added: AddedCredentialIds) {
  if (Object.keys(added).length === 0) return
  try {
    const conversation = await getConversationBySessionId(sessionId)

    if (!conversation?.teamId) return
    const answered: string[] = []
    const providers = new Set<string>()

    for (const request of openInputRequests(conversation)) {
      const selected = selectedProviders(request, added)

      // Only the call that resolves it wakes the agent, so a question wakes it once.
      if (
        selected.length &&
        (await resolveInputRequest(sessionId, conversation.userId, request.id))
      ) {
        answered.push(request.id)
        selected.forEach((provider) => providers.add(provider))
      }
    }
    if (!answered.length) return
    logEvent('info', 'agent.pending_decision.credential_selected', {
      session_id: sessionId,
      request_ids: answered.join(','),
    })
    const { startConversationTurn } = await import('./conversation-turn')
    const { run } = await startConversationTurn(
      {
        userId: conversation.userId,
        teamId: conversation.teamId,
        targetSessionId: sessionId,
        messageId: randomUUID(),
        locale: conversation.metadata?.locale ?? 'en-US',
      },
      conversation,
      `The credentials you asked for are now selected for this conversation (${[...providers].join(', ')}), ` +
        `so your question is answered (requestId ${answered.join(', ')}). ` +
        'Call list_credentials to see them, then continue the task.',
      'agent.resource',
      systemSender('nuphos:credentials', 'Nuphos'),
    )

    await run
  } catch (error) {
    logError('agent.pending_decision.credential_selected_failed', error, { session_id: sessionId })
  }
}
