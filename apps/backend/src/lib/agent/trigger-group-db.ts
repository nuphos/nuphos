import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'

import type { AgentCredentialAccess } from './db'
import type { TriggerCredentialMode } from './trigger-credential-access'
import type { TriggerExecutionAuthorizationStatus } from './trigger-db'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'
import type { Collection } from 'mongodb'

export const MAX_TRIGGER_GROUP_MEMBERS = 50

export type TriggerGroupMember = {
  key: string
  provider: string
  integrationId: string
  kind: string
  resourceId: string
}

export type TriggerGroupPartition = {
  key: string
  provider: string
  integrationId: string
  memberKeys: string[]
  triggerId: ObjectId
}

export type AgentTriggerGroup = {
  _id?: ObjectId
  userId: string
  teamId: string
  createdByUserId?: string
  executionPrincipalUserId?: string
  /** See `AgentTrigger.credentialMode`; ingresses inherit the Group's. */
  credentialMode?: TriggerCredentialMode
  executionCredentialAccess?: AgentCredentialAccess
  executionAuthorizationStatus?: TriggerExecutionAuthorizationStatus
  executionAuthorizationCheckedAt?: Date
  executionAuthorizationError?: string
  name: string
  /**
   * Canonical prompt shared by every provider ingress in this Group.
   * Optional for compatibility with Groups created before this field existed;
   * the service backfills it from an existing partition trigger.
   */
  messageTemplate?: string
  members: TriggerGroupMember[]
  partitions: TriggerGroupPartition[]
  /** Server-scoped idempotency boundary for the selected members + destination. */
  dedupeKey: string
  /** Retained so a provisioning retry recreates every ingress with the same guard. */
  minIntervalSeconds?: number
  slackDestination?: SlackOutboundDestination
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type TriggerGroupMemberRun = {
  _id?: ObjectId
  groupId: ObjectId
  memberKey: string
  lastRunAt: Date
}

/**
 * The first Watch Group prototype stored only memberKeys and provisioning
 * limits. Those documents intentionally remain in Mongo so their standalone
 * triggers keep working, but they are not compatible with the shared-ingress
 * model. Keep the compatibility check at the collection boundary so one
 * legacy document cannot make the entire Trigger management view fail.
 */
export function isSharedIngressTriggerGroup(value: unknown): value is AgentTriggerGroup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as { members?: unknown; partitions?: unknown }

  return (
    Array.isArray(candidate.members) &&
    Array.isArray(candidate.partitions) &&
    candidate.partitions.every(
      (partition: unknown) =>
        partition !== null &&
        typeof partition === 'object' &&
        (partition as { triggerId?: unknown }).triggerId instanceof ObjectId,
    )
  )
}

const COLLECTION = 'agent_trigger_groups'
const RUNS_COLLECTION = 'agent_trigger_group_member_runs'

export const agentTriggerGroups = (): Collection<AgentTriggerGroup> =>
  db().collection<AgentTriggerGroup>(COLLECTION)

export const triggerGroupMemberRuns = (): Collection<TriggerGroupMemberRun> =>
  db().collection<TriggerGroupMemberRun>(RUNS_COLLECTION)

export async function setupTriggerGroupIndexes(): Promise<void> {
  const groups = agentTriggerGroups()

  await groups.updateMany(
    {
      $or: [
        { createdByUserId: { $exists: false } },
        { executionPrincipalUserId: { $exists: false } },
        { executionAuthorizationStatus: { $exists: false } },
      ],
    },
    [
      {
        $set: {
          createdByUserId: { $ifNull: ['$createdByUserId', '$userId'] },
          executionPrincipalUserId: {
            $ifNull: ['$executionPrincipalUserId', { $ifNull: ['$createdByUserId', '$userId'] }],
          },
          executionAuthorizationStatus: {
            $ifNull: ['$executionAuthorizationStatus', 'unchecked'],
          },
        },
      },
    ],
  )
  await groups.createIndex(
    { userId: 1, teamId: 1, createdAt: -1 },
    { background: true, name: 'trigger_groups_owner_createdAt' },
  )
  await groups.createIndex(
    { teamId: 1, createdAt: -1 },
    { background: true, name: 'trigger_groups_team_createdAt' },
  )
  await groups.createIndex(
    { dedupeKey: 1 },
    { unique: true, background: true, name: 'trigger_group_dedupe_unique' },
  )
  await groups.createIndex(
    { 'partitions.triggerId': 1 },
    { background: true, name: 'trigger_group_partition_trigger' },
  )
  await triggerGroupMemberRuns().createIndex(
    { groupId: 1, memberKey: 1 },
    { unique: true, background: true, name: 'trigger_group_member_run_unique' },
  )
}

export function parseTriggerGroupMemberKey(memberKey: string): TriggerGroupMember | null {
  try {
    const value: unknown = JSON.parse(memberKey)

    if (
      !Array.isArray(value) ||
      value.length !== 4 ||
      !value.every((part) => typeof part === 'string' && part.length > 0)
    ) {
      return null
    }

    return {
      key: memberKey,
      provider: value[0],
      integrationId: value[1],
      kind: value[2],
      resourceId: value[3],
    }
  } catch {
    return null
  }
}

export function triggerGroupPartitionKey(input: {
  provider: string
  integrationId: string
}): string {
  return JSON.stringify([input.provider, input.integrationId])
}
