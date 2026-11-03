import { CREDENTIAL_LISTERS } from '@/lib/claude-code-preview/credential-listing'
import { logEvent } from '@/lib/observability'
import { getAgentCredentialOptions } from '@/routes/agent/credential-options'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import { addConversationCredentialIds, removeConversationCredentialIds } from './db'

import type { AgentConversation, AgentCredentialAccess } from './db'
import type { ThreadActor } from './thread-bridge'
import type { SelectionKey } from '@/lib/claude-code-preview/credential-lister'
import type { AgentCredentialOptions } from '@/routes/agent/types'

export type CredentialRef = { provider: string; id: string }
type Fields = Partial<Record<SelectionKey, string[]>>

const named = (ref: CredentialRef) => `${ref.provider} ${ref.id}`
const has = (entries: CredentialRef[], ref: CredentialRef) =>
  entries.some(({ provider, id }) => provider === ref.provider && id === ref.id)
const selectionKeys = Object.keys(CREDENTIAL_LISTERS) as SelectionKey[]
const changedMeanwhile = () =>
  new Error("The thread's selection changed meanwhile; call update_thread again.")

function notSelectedHere(pending: CredentialRef[]) {
  return new Error(
    `Not selected for this conversation: ${pending.map(named).join(', ')}. ` +
      'Grant only (provider, id) pairs from its own list_credentials.',
  )
}

/**
 * The selection a new thread starts with. Without `credentials` it inherits the
 * parent's whole selection; with them it gets exactly those, each one the parent
 * has selected now, as its own list_credentials shows it. Anything else is refused.
 */
export async function threadCredentialAccess(
  actor: ThreadActor,
  source: AgentConversation,
  credentials: CredentialRef[] | undefined,
): Promise<AgentCredentialAccess | undefined> {
  if (!credentials) return source.credentialAccess
  const [parent, options] = await Promise.all([
    getAgentCredentialAccess({ userId: actor.userId, sessionId: actor.sessionId }, actor.teamId),
    getAgentCredentialOptions(actor.teamId, actor.userId),
  ])
  const fields: Fields = {}
  let pending = credentials

  for (const key of selectionKeys) {
    const ofParent = CREDENTIAL_LISTERS[key](parent[key], options).selected

    // Every field is set, so one whose unset selection means all is narrowed too.
    fields[key] = [...new Set(pending.filter((ref) => has(ofParent, ref)).map((ref) => ref.id))]
    pending = pending.filter((ref) => !has(ofParent, ref))
  }
  if (pending.length) throw notSelectedHere(pending)
  const teamIdentity = source.credentialAccess?.teamIdentity

  return {
    ...fields,
    ...(teamIdentity ? { teamIdentity } : {}),
    updatedAt: new Date(),
    updatedBy: actor.userId,
  } as AgentCredentialAccess
}

/**
 * Changes a thread's selection. `grant` adds credentials and devices the parent
 * has selected now, as its own list_credentials shows them; `revoke` removes
 * ones the thread has selected. Both are checked before any write, and each
 * write is atomic, so nothing else in the selection is overwritten.
 */
export async function changeThreadCredentials(
  actor: ThreadActor,
  threadId: string,
  change: { grant?: CredentialRef[]; revoke?: CredentialRef[] },
) {
  const { grant = [], revoke = [] } = change

  if (!grant.length && !revoke.length) return {}
  const both = grant.filter((ref) => has(revoke, ref))

  if (both.length) throw new Error(`Both granted and revoked: ${both.map(named).join(', ')}.`)
  const agent = (sessionId: string) => ({ userId: actor.userId, sessionId })
  const [parent, thread, options] = await Promise.all([
    getAgentCredentialAccess(agent(actor.sessionId), actor.teamId),
    getAgentCredentialAccess(agent(threadId), actor.teamId),
    getAgentCredentialOptions(actor.teamId, actor.userId),
  ])
  const { add, pull, narrow } = planChange(parent, thread, options, grant, revoke)

  if (Object.keys(add).length) await addToThread(actor, threadId, add, options)
  if (Object.keys(pull).length || Object.keys(narrow).length)
    await removeFromThread(actor, threadId, pull, narrow)

  return {
    ...(grant.length ? { granted: grant } : {}),
    ...(revoke.length ? { revoked: revoke } : {}),
  }
}

type Selection = Awaited<ReturnType<typeof getAgentCredentialAccess>>

/** The writes a grant and revoke make, or the refusal of pairs neither side has. */
function planChange(
  parent: Selection,
  thread: Selection,
  options: AgentCredentialOptions,
  grant: CredentialRef[],
  revoke: CredentialRef[],
) {
  const add: Fields = {}
  const pull: Fields = {}
  const narrow: Fields = {}
  let toGrant = grant
  let toRevoke = revoke

  for (const key of selectionKeys) {
    const ofParent = CREDENTIAL_LISTERS[key](parent[key], options).selected
    const ofThread = CREDENTIAL_LISTERS[key](thread[key], options).selected
    const adds = toGrant.filter((ref) => has(ofParent, ref) && !has(ofThread, ref))
    const drops = toRevoke.filter((ref) => has(ofThread, ref))

    toGrant = toGrant.filter((ref) => !has(ofParent, ref))
    toRevoke = toRevoke.filter((ref) => !has(ofThread, ref))
    if (adds.length) add[key] = adds.map((ref) => ref.id)
    if (!drops.length) continue
    // Unset (missing, or null as the driver stores undefined) means all of them
    // here, so removing some sets the field to the rest.
    if (!thread[key])
      narrow[key] = ofThread.filter((entry) => !has(drops, entry)).map((entry) => entry.id)
    else pull[key] = drops.map((ref) => ref.id)
  }
  if (toGrant.length) throw notSelectedHere(toGrant)
  if (toRevoke.length) {
    throw new Error(
      `Not selected for the thread: ${toRevoke.map(named).join(', ')}. ` +
        'Revoke only (provider, id) pairs the thread has.',
    )
  }

  return { add, pull, narrow }
}

async function removeFromThread(
  actor: ThreadActor,
  threadId: string,
  pull: Fields,
  narrow: Fields,
) {
  if (!(await removeConversationCredentialIds(threadId, actor.userId, actor.teamId, pull, narrow)))
    throw changedMeanwhile()
  logEvent('info', 'agent.thread.credentials_revoked', {
    session_id: threadId,
    source_session_id: actor.sessionId,
    fields: [...Object.keys(pull), ...Object.keys(narrow)].join(','),
  })
}

async function addToThread(
  actor: ThreadActor,
  threadId: string,
  fields: Fields,
  options: AgentCredentialOptions,
) {
  const keys = Object.keys(fields) as SelectionKey[]
  // Where unset means all of them, the field must still be set, or adding narrows it.
  const existing = keys.filter(
    (key) =>
      CREDENTIAL_LISTERS[key](undefined, options).selected.length >
      CREDENTIAL_LISTERS[key]([], options).selected.length,
  )

  if (!(await addConversationCredentialIds(threadId, actor.userId, actor.teamId, fields, existing)))
    throw changedMeanwhile()
  logEvent('info', 'agent.thread.credentials_granted', {
    session_id: threadId,
    source_session_id: actor.sessionId,
    fields: keys.join(','),
  })
}
