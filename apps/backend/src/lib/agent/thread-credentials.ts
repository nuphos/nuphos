import { CREDENTIAL_LISTERS } from '@/lib/claude-code-preview/credential-listing'
import { logEvent } from '@/lib/observability'
import { getAgentCredentialOptions } from '@/routes/agent/credential-options'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import { addConversationCredentialIds } from './db'

import type { ThreadActor } from './thread-bridge'
import type { SelectionKey } from '@/lib/claude-code-preview/credential-lister'

export type CredentialRef = { provider: string; id: string }

const named = (ref: CredentialRef) => `${ref.provider} ${ref.id}`

/**
 * Adds to a thread's selection credentials and devices the parent has selected
 * now, as its own list_credentials shows them; anything else is refused before
 * any write. The ids are added atomically, so nothing else is overwritten.
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
  const fields: Partial<Record<SelectionKey, string[]>> = {}
  let pending = grant

  for (const key of Object.keys(CREDENTIAL_LISTERS) as SelectionKey[]) {
    const ofParent = CREDENTIAL_LISTERS[key](parent[key], options).selected
    const ofThread = CREDENTIAL_LISTERS[key](thread[key], options).selected
    const add = pending.filter((ref) => has(ofParent, ref) && !has(ofThread, ref))

    pending = pending.filter((ref) => !has(ofParent, ref))
    if (add.length) fields[key] = add.map((ref) => ref.id)
  }
  if (pending.length) {
    throw new Error(
      `Not selected for this conversation: ${pending.map(named).join(', ')}. ` +
        'Grant only (provider, id) pairs from its own list_credentials.',
    )
  }
  const keys = Object.keys(fields) as SelectionKey[]

  if (keys.length) {
    // Where unset means all of them, the field must still be set, or adding narrows it.
    const existing = keys.filter(
      (key) =>
        CREDENTIAL_LISTERS[key](undefined, options).selected.length >
        CREDENTIAL_LISTERS[key]([], options).selected.length,
    )

    if (
      !(await addConversationCredentialIds(threadId, actor.userId, actor.teamId, fields, existing))
    )
      throw new Error("The thread's selection changed meanwhile; call update_thread again.")
    logEvent('info', 'agent.thread.credentials_granted', {
      session_id: threadId,
      source_session_id: actor.sessionId,
      fields: keys.join(','),
    })
  }

  return grant
}
