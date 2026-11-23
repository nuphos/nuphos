import { db, withTransaction } from '@/lib/db'

import { assertTeamMember, readsTriggerConversation } from './trigger-access'

import type { TriggerActor, TriggerActorContext } from './trigger-access'
import type { AgentTrigger } from './trigger-db'
import type { ClientSession, Collection, ObjectId } from 'mongodb'

/** What a Trigger runs with. Its webhook secret is not among them and is never recorded. */
export const TRIGGER_CONFIG = [
  'name',
  'triggerType',
  'cronExpression',
  'timeZone',
  'targetSessionId',
  'messageTemplate',
  'enabled',
  'expiresAt',
  'minIntervalSeconds',
  'payloadFilters',
  'credentialMode',
  'executionCredentialAccess',
  'source',
  'sourceContext',
] as const

export type TriggerConfig = Partial<Pick<AgentTrigger, (typeof TRIGGER_CONFIG)[number]>>

/**
 * Where a change came from. `request`: a call to the API, from an app, an
 * agent (`agentSessionId`) or a script (`client` names the app when it said).
 * The rest are Nuphos's own: undoing a write the scheduler could not follow
 * (`rollback`), and pausing a Trigger that expired, lost the right to run or
 * kept failing.
 */
export type TriggerChangeVia =
  'request' | 'bot_import' | 'rollback' | 'expiry' | 'authorization' | 'failed_runs'

export type TriggerChangeBy = {
  /** A user id, or `system`. */
  actorId: string
  agentSessionId?: string
  via: TriggerChangeVia
  client?: string
}

/** Who changed a Trigger, as its service was called. */
export function changedBy(actor: TriggerActor): TriggerChangeBy {
  if (typeof actor === 'string') return { actorId: actor, via: 'request' }

  return {
    actorId: actor.userId,
    via: actor.via ?? 'request',
    ...(actor.sessionId ? { agentSessionId: actor.sessionId } : {}),
    ...(actor.client ? { client: actor.client } : {}),
  }
}

/** One create, change or delete of a Trigger. Never removed, not even with the Trigger. */
export type TriggerChange = TriggerChangeBy & {
  _id?: ObjectId
  at: Date
  triggerId: string
  teamId?: string
  /** The Trigger's owner and Task, as when it changed: who may read the record follows them. */
  userId: string
  targetSessionId?: string
  action: 'created' | 'updated' | 'deleted'
  /** Why Nuphos paused it, or a change its config cannot show, such as a new webhook secret. */
  reason?: string
  before?: TriggerConfig
  after?: TriggerConfig
}

export const triggerHistory = (): Collection<TriggerChange> =>
  db().collection<TriggerChange>('agent_trigger_history')

const config = (trigger: AgentTrigger): TriggerConfig =>
  Object.fromEntries(
    TRIGGER_CONFIG.flatMap((key) => (trigger[key] === undefined ? [] : [[key, trigger[key]]])),
  )

/**
 * The one way to create, change or delete a Trigger. `write` makes the change
 * with `session` and answers whether it applied; when it did, its record lands
 * in the same transaction, so neither lands without the other. `before` is
 * absent for a new Trigger, `after` for a deleted one.
 */
export async function writeTrigger(
  change: { before?: AgentTrigger; after?: AgentTrigger; by: TriggerChangeBy; reason?: string },
  write: (session: ClientSession) => Promise<boolean>,
): Promise<boolean> {
  const { before, after, by, reason } = change
  const trigger = after ?? before

  if (!trigger?._id) throw new Error('A Trigger change needs the Trigger')
  const triggerId = trigger._id.toHexString()
  let action: TriggerChange['action'] = 'updated'

  if (!before) action = 'created'
  else if (!after) action = 'deleted'
  // A write that leaves what the Trigger runs with as it was has nothing to record.
  const unchanged =
    before && after && JSON.stringify(config(before)) === JSON.stringify(config(after))
  let applied = false

  await withTransaction(async (session) => {
    applied = await write(session)
    if (!applied || (unchanged && !reason)) return
    await triggerHistory().insertOne(
      {
        ...by,
        at: new Date(),
        triggerId,
        ...(trigger.teamId ? { teamId: trigger.teamId } : {}),
        userId: trigger.userId,
        ...(trigger.targetSessionId ? { targetSessionId: trigger.targetSessionId } : {}),
        action,
        ...(reason ? { reason } : {}),
        ...(before ? { before: config(before) } : {}),
        ...(after ? { after: config(after) } : {}),
      },
      { session },
    )
  })

  return applied
}

export async function setupTriggerHistoryIndexes(): Promise<void> {
  await triggerHistory().createIndex(
    { teamId: 1, triggerId: 1, at: -1 },
    { name: 'trigger_history_team_trigger_at' },
  )
  await triggerHistory().createIndex({ teamId: 1, at: -1 }, { name: 'trigger_history_team_at' })
}

/**
 * The records the actor may read, newest first: of the team's Triggers, or
 * their own personal ones, deleted Triggers included. Reading a record follows
 * the Trigger's Task, as reading the Trigger does.
 */
export async function readTriggerHistory(actor: TriggerActorContext, triggerId?: string) {
  if (actor.teamId) await assertTeamMember(actor)
  const cursor = triggerHistory()
    .find({
      ...(actor.teamId
        ? { teamId: actor.teamId }
        : { userId: actor.userId, teamId: { $exists: false } }),
      ...(triggerId ? { triggerId } : {}),
    })
    .sort({ at: -1, _id: -1 })
  // Read in order until 200 are readable, so records of Tasks the actor cannot
  // read never crowd out ones they can. Each Task is checked once.
  const reads = new Map<string, boolean>()
  const rows: TriggerChange[] = []

  for await (const row of cursor) {
    const key = `${row.userId} ${row.targetSessionId ?? ''}`
    const read = reads.get(key) ?? (await readsTriggerConversation(row, actor.userId))

    reads.set(key, read)
    if (read) rows.push(row)
    if (rows.length === 200) break
  }
  await cursor.close()

  return rows.map(({ _id: _ignored, at, actorId, agentSessionId, before, after, ...rest }) => ({
    ...rest,
    at: at.toISOString(),
    actor: actorOf(actorId, agentSessionId),
    ...(before ? { before: plain(before) } : {}),
    ...(after ? { after: plain(after) } : {}),
  }))
}

const actorOf = (actorId: string, agentSessionId?: string) =>
  actorId === 'system'
    ? { type: 'system' as const }
    : {
        type: agentSessionId ? ('agent' as const) : ('user' as const),
        userId: actorId,
        ...(agentSessionId ? { agentSessionId } : {}),
      }

const plain = ({ expiresAt, ...rest }: TriggerConfig) => ({
  ...rest,
  ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
})
