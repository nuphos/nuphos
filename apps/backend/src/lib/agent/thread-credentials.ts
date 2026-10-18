import { CREDENTIAL_LISTERS } from '@/lib/claude-code-preview/credential-listing'
import { logEvent } from '@/lib/observability'
import { getAgentCredentialOptions } from '@/routes/agent/credential-options'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import { setConversationCredentialFields } from './db'

import type { AgentCredentialAccess } from './db'
import type { ThreadActor } from './thread-bridge'
import type { SelectionKey } from '@/lib/claude-code-preview/credential-lister'

export type CredentialRef = { provider: string; id: string }

const named = (ref: CredentialRef) => `${ref.provider} ${ref.id}`

/**
 * Adds to a thread's selection credentials and devices the parent has selected
 * now, as its own list_credentials shows them; anything else is refused. Only
 * the named fields are written, so the rest of the thread's selection is kept.
 */
export async function grantThreadCredentials(
  actor: ThreadActor,
  threadId: string,
  grant: CredentialRef[] | undefined,
) {
  if (!grant?.length) return undefined
  const agent = (sessionId: string) => ({ userId: actor.userId, sessionId })
  const [parent, thread, options] = await Promise.all([
    getAgentCredentialAccess(agent(actor.sessionId), actor.teamId),
    getAgentCredentialAccess(agent(threadId), actor.teamId),
    getAgentCredentialOptions(actor.teamId, actor.userId),
  ])
  const has = (entries: CredentialRef[], ref: CredentialRef) =>
    entries.some(({ provider, id }) => provider === ref.provider && id === ref.id)
  const fields: Partial<AgentCredentialAccess> = {}
  let pending = grant

  for (const key of Object.keys(CREDENTIAL_LISTERS) as SelectionKey[]) {
    const ofParent = CREDENTIAL_LISTERS[key](parent[key], options).selected
    const ofThread = CREDENTIAL_LISTERS[key](thread[key], options).selected
    const add = pending.filter((ref) => has(ofParent, ref) && !has(ofThread, ref))

    pending = pending.filter((ref) => !has(ofParent, ref))
    if (add.length) fields[key] = [...new Set([...(thread[key] ?? []), ...add.map((r) => r.id)])]
  }
  if (pending.length) {
    throw new Error(
      `Not selected for this conversation: ${pending.map(named).join(', ')}. ` +
        'Grant only (provider, id) pairs from its own list_credentials.',
    )
  }
  if (Object.keys(fields).length) {
    await setConversationCredentialFields(threadId, actor.userId, actor.teamId, fields)
    logEvent('info', 'agent.thread.credentials_granted', {
      session_id: threadId,
      source_session_id: actor.sessionId,
      fields: Object.keys(fields).join(','),
    })
  }

  return grant
}
