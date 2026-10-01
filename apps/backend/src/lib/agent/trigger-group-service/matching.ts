import { createHash } from 'node:crypto'

import { agentTriggers } from '../trigger-db'
import { agentTriggerGroups, triggerGroupMemberRuns } from '../trigger-group-db'

import type { TriggerGroupMember } from '../trigger-group-db'
import type { ObjectId } from 'mongodb'

const MAX_EVENT_MATCH_NODES = 10_000

function scalarStrings(value: unknown, output: Set<string>): void {
  const pending: unknown[] = [value]
  const visited = new Set<object>()
  let examined = 0

  while (pending.length > 0 && examined < MAX_EVENT_MATCH_NODES) {
    const current = pending.pop()

    examined += 1
    if (typeof current === 'string' || typeof current === 'number') {
      output.add(String(current))
      continue
    }
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index])
      }
      continue
    }
    const values = Object.values(current as Record<string, unknown>)

    for (let index = values.length - 1; index >= 0; index -= 1) {
      pending.push(values[index])
    }
  }
}

function containsAnyScalar(value: unknown, aliases: string[]): boolean {
  const values = new Set<string>()

  scalarStrings(value, values)

  return aliases.some((alias) => values.has(alias))
}

function scopePayloadToMember(payload: unknown, aliases: string[]): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const root = payload as Record<string, unknown>

  if (!Array.isArray(root.alerts)) return payload
  const alerts = root.alerts.filter((alert) => containsAnyScalar(alert, aliases))

  if (alerts.length === 0 || alerts.length === root.alerts.length) return payload
  const statuses = alerts.flatMap((alert) => {
    if (!alert || typeof alert !== 'object') return []
    const status = (alert as Record<string, unknown>).status

    return typeof status === 'string' ? [status.toLowerCase()] : []
  })

  return {
    ...root,
    alerts,
    ...(statuses.includes('firing')
      ? { status: 'firing' }
      : statuses.length > 0 && statuses.every((status) => status === 'resolved')
        ? { status: 'resolved' }
        : {}),
  }
}

export function matchConfiguredTriggerGroupMembers(input: {
  members: TriggerGroupMember[]
  memberKeys: string[]
  eventMatches: { memberKey: string; values: string[] }[]
  payload: unknown
}): { member: TriggerGroupMember; payload: unknown }[] {
  const values = new Set<string>()

  scalarStrings(input.payload, values)
  const configuredMatches = new Map(
    input.eventMatches.map((match) => [match.memberKey, match.values]),
  )

  return input.members.flatMap((member) => {
    if (!input.memberKeys.includes(member.key)) return []
    const aliases = configuredMatches.get(member.key)

    if (!aliases?.some((alias) => values.has(alias))) return []

    return [
      {
        member,
        payload: scopePayloadToMember(input.payload, aliases),
      },
    ]
  })
}

export function triggerGroupIncidentScope(memberKey: string): string {
  return `member:${createHash('sha256').update(memberKey).digest('hex').slice(0, 32)}`
}

export async function matchTriggerGroupMembers(input: {
  triggerId: ObjectId
  source?: string
  payload: unknown
}): Promise<{ member: TriggerGroupMember; payload: unknown }[]> {
  const [group, trigger] = await Promise.all([
    agentTriggerGroups().findOne({ 'partitions.triggerId': input.triggerId }),
    agentTriggers().findOne({ _id: input.triggerId }, { projection: { providerWiring: 1 } }),
  ])

  if (!group?.enabled) return []
  const partition = group.partitions.find((item) => item.triggerId.equals(input.triggerId))

  if (!partition || (input.source && input.source !== partition.key)) return []
  if (trigger?.providerWiring?.provider !== 'watch_group') return []

  return matchConfiguredTriggerGroupMembers({
    members: group.members,
    memberKeys: partition.memberKeys,
    eventMatches: trigger.providerWiring.eventMatches,
    payload: input.payload,
  })
}

export async function claimTriggerGroupMemberRun(input: {
  groupId: ObjectId
  memberKey: string
  cooldownSeconds: number
}): Promise<boolean> {
  if (input.cooldownSeconds <= 0) return true
  const now = new Date()
  const cutoff = new Date(now.getTime() - input.cooldownSeconds * 1000)
  const claimed = await triggerGroupMemberRuns()
    .findOneAndUpdate(
      {
        groupId: input.groupId,
        memberKey: input.memberKey,
        $or: [{ lastRunAt: { $exists: false } }, { lastRunAt: { $lte: cutoff } }],
      },
      { $set: { lastRunAt: now } },
      { upsert: true, returnDocument: 'after' },
    )
    .catch((error: unknown) => {
      if ((error as { code?: number })?.code === 11000) return null
      throw error
    })

  return claimed !== null
}
