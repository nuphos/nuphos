import { randomUUID } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { importedRows } from './records'
import { invalidArchive } from './zip'

import type { MigrationPart } from './format'
import type { validateTeamArchive } from './validate'

export type ValidatedArchive = Awaited<ReturnType<typeof validateTeamArchive>>

// Historical identities never grant membership. Only an explicitly selected
// source identity maps to the signed-in importer; every other id is new.
export async function migrationIds(archive: ValidatedArchive, actorId: string, selfId?: string) {
  const members = []

  for await (const row of importedRows(archive.paths.get('members.json')!))
    members.push(...(row as unknown as { sourceUserId: string; name: string }[]))
  if (selfId && !members.some((member) => member.sourceUserId === selfId))
    invalidArchive('selected source member is not in the archive')
  const users = new Map<string, string>()
  const ids = new Map<string, string>()
  const user = (source: string) => {
    if (!users.has(source))
      users.set(source, source === selfId ? actorId : new ObjectId().toHexString())

    return users.get(source)!
  }
  const key = (part: MigrationPart, source: string) => `${part}:${source}`

  for (const [part, values] of archive.keys) {
    for (const source of values) {
      if (part === 'work/plans.ndjson') ids.set(key(part, source), source)
      else
        ids.set(
          key(part, source),
          part === 'conversations/sessions.ndjson' || part === 'conversations/messages.ndjson'
            ? randomUUID()
            : new ObjectId().toHexString(),
        )
    }
  }
  const ref = (part: MigrationPart, source: unknown) => {
    const value = typeof source === 'string' ? ids.get(key(part, source)) : undefined

    if (!value) invalidArchive('unresolved record reference')

    return value
  }
  const objectIds = new Map<string, ObjectId>()
  const object = (part: MigrationPart, source: unknown) => {
    const value = ref(part, source)

    if (!objectIds.has(value)) objectIds.set(value, new ObjectId(value))

    return objectIds.get(value)!
  }

  for (const member of members) user(member.sourceUserId)

  return { user, ref, object, members, users, ids }
}

export type MigrationIds = Awaited<ReturnType<typeof migrationIds>>
const sessions = 'conversations/sessions.ndjson'
const memories = 'knowledge/memories.ndjson'
const dateFields = [
  'createdAt',
  'updatedAt',
  'lastActiveAt',
  'archivedAt',
  'disabledAt',
  'lastVerifiedAt',
  'expiresAt',
] as const

export function remapRecord(
  part: MigrationPart,
  source: Record<string, unknown>,
  ids: MigrationIds,
  teamId: string,
  actorId: string,
): Record<string, unknown> {
  const row = { ...source }

  for (const field of dateFields)
    if (typeof row[field] === 'string') row[field] = new Date(row[field])
  for (const field of ['createdBy', 'updatedBy', 'disabledBy'] as const)
    if (typeof row[field] === 'string') row[field] = ids.user(row[field])
  const mapSession = (field: string) => {
    if (row[field]) row[field] = ids.ref(sessions, row[field])
  }

  switch (part) {
    case sessions:
      row._id = new ObjectId()
      row.sessionId = ids.ref(sessions, row.sessionId)
      row.teamId = teamId
      row.userId = actorId
      row.participantIds = []
      row.messageCount = 0
      mapSession('parentSessionId')
      mapSession('leadAgentSessionId')
      if (Array.isArray(row.agentSessionIds))
        row.agentSessionIds = row.agentSessionIds.map((id) => ids.ref(sessions, id))
      break
    case 'conversations/messages.ndjson': {
      const sourceSession = source.sessionId as string

      row._id = new ObjectId()
      row.sessionId = ids.ref(sessions, sourceSession)
      row.messageId = ids.ref(part, `${sourceSession}:${String(row.messageId)}`)
      row.userId = actorId
      // Never turn archive-supplied metadata into a server attestation.
      // Keep the original for provenance and show a plain historical label.
      const metadata = source.metadata as { sender: { displayName: string } } | undefined
      const member = ids.members.find((value) => value.sourceUserId === source.userId)
      const label = metadata?.sender.displayName ?? member?.name ?? 'Unknown author'

      row.importedMetadata = source.metadata
      delete row.metadata
      row.parts = [
        { type: 'text', text: `[Imported conversation history — ${label}]` },
        ...(row.parts as unknown[]),
      ]
      break
    }
    case 'knowledge/instructions.ndjson':
      row._id = ids.object(part, source._id)
      row.teamId = new ObjectId(teamId)
      row.scope = 'team'
      break
    case memories:
      row._id = ids.object(part, `${String(row.kind)}:${String(source._id)}`)
      row.teamId = teamId
      if (row.kind === 'record') {
        mapSession('restrictedToSessionId')
        row.conversationId =
          row.conversationId && ids.ids.has(`${sessions}:${row.conversationId as string}`)
            ? ids.ref(sessions, row.conversationId)
            : null
        if (row.supersededBy)
          row.supersededBy = ids.object(part, `record:${row.supersededBy as string}`)
      } else {
        row.lineageId = ids.user(`lineage:${String(row.lineageId)}`)
        if (row.supersedesId)
          row.supersedesId = ids.object(part, `playbook:${row.supersedesId as string}`)
        row.capsules = (row.capsules as Record<string, unknown>[]).map((capsule) => ({
          ...capsule,
          conversationId: ids.ids.has(`${sessions}:${String(capsule.conversationId)}`)
            ? ids.ref(sessions, capsule.conversationId)
            : '',
          planId: undefined,
          toolCallIds: [],
          sourceMemoryIds: undefined,
          authorUserId: ids.user(String(capsule.authorUserId)),
          observedAt: new Date(String(capsule.observedAt)),
        }))
      }
      delete row.kind
      break
    case 'work/plans.ndjson':
      delete row.id
      row._id = new ObjectId()
      row.teamId = teamId
      row.status = 'proposed'
      row.createdBy = actorId
      mapSession('sourceConversationId')
      break
    case 'work/dashboards.ndjson': {
      row._id = ids.object(part, source.id)
      delete row.id
      row.teamId = new ObjectId(teamId)
      row.createdBy = actorId
      row.layout = (row.layout as Record<string, unknown>[]).map((cell) => ({
        ...cell,
        panelId: ids.object('work/panels.ndjson', cell.panelId),
      }))
      const time = row.timeRange as Record<string, unknown>

      row.timeRange = {
        periodStart: new Date(String(time.periodStart)),
        periodEnd: new Date(String(time.periodEnd)),
        ...(time.granularity ? { granularity: time.granularity } : {}),
      }
      if (!row.rangePreset) delete row.rangePreset
      delete row.cadence
      break
    }
    case 'work/panels.ndjson':
      row._id = ids.object(part, source._id)
      row.teamId = new ObjectId(teamId)
      row.createdBy = actorId
      row.dashboardId = ids.object('work/dashboards.ndjson', row.dashboardId)
      row.versions = (row.versions as Record<string, unknown>[]).map((version) => ({
        ...version,
        authoredBy: ids.user(String(version.authoredBy)),
        createdAt: new Date(String(version.createdAt)),
      }))
      break
    case 'work/diagrams.ndjson':
    case 'work/designs.ndjson':
      row._id = ids.object(part, source._id)
      row.teamId = new ObjectId(teamId)
      break
    case 'work/triggers.ndjson':
      // Every imported conversation is owned by the importer. This is a
      // derived Task-owner copy, never authority restored from the ZIP.
      row.userId = actorId
      row.teamId = teamId
      row._id = ids.object(part, source._id)
      mapSession('targetSessionId')
      row.enabled = false
      break
    case 'team.json':
    case 'members.json':
    case 'knowledge/skills.ndjson':
    case 'knowledge/skill-files.ndjson':
    case 'work/bots.ndjson':
    case 'work/schedules.ndjson':
    case 'not-migrated.json':
      invalidArchive('unsupported destination collection')
  }

  return row
}
