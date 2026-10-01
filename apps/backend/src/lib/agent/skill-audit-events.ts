import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import type { SkillMutationEvent } from './skill-store/metadata'

export type AuditEventKind = 'agent' | 'skill' | 'runtime'

export type AuditEventCursor = {
  ts: string
  kind: AuditEventKind
  id: ObjectId
}

/** Descending tie-break between sources sharing a timestamp. */
const KIND_RANK: Record<AuditEventKind, number> = { agent: 2, skill: 1, runtime: 0 }

export const AUDIT_CURSOR_KIND: Record<AuditEventKind, string> = {
  agent: 'a',
  skill: 's',
  runtime: 'r',
}

function cursorKind(part: string | undefined): AuditEventKind | '' {
  const found = (Object.keys(AUDIT_CURSOR_KIND) as AuditEventKind[]).find(
    (kind) => AUDIT_CURSOR_KIND[kind] === part,
  )

  return found ?? ''
}

/** Accepts both the old agent-only ts~id cursor and the mixed ts~kind~id cursor. */
export function parseAuditEventCursor(raw: string): AuditEventCursor {
  const parts = raw.split('~')
  const [ts, kindPart, idPart]: [string | undefined, AuditEventKind | '', string | undefined] =
    parts.length === 2 ? [parts[0], 'agent', parts[1]] : [parts[0], cursorKind(parts[1]), parts[2]]

  if (!ts || Number.isNaN(Date.parse(ts)) || !idPart || !ObjectId.isValid(idPart) || !kindPart) {
    throw new AppError(400, 'invalid_request', 'malformed cursor')
  }

  return { ts, kind: kindPart, id: new ObjectId(idPart) }
}

/** Cursor predicate for a descending (timestamp, source-kind, ObjectId) merge. */
export function auditCursorClause(
  field: 'ts' | 'createdAt',
  kind: AuditEventKind,
  cursor: AuditEventCursor,
): Record<string, unknown> {
  const timestamp = field === 'createdAt' ? new Date(cursor.ts) : cursor.ts
  const kindRank = KIND_RANK[kind]
  const cursorRank = KIND_RANK[cursor.kind]

  if (kindRank < cursorRank) {
    return { $or: [{ [field]: { $lt: timestamp } }, { [field]: timestamp }] }
  }
  if (kindRank > cursorRank) {
    return { [field]: { $lt: timestamp } }
  }

  return {
    $or: [{ [field]: { $lt: timestamp } }, { [field]: timestamp, _id: { $lt: cursor.id } }],
  }
}

export function skillAuditEvent(doc: SkillMutationEvent) {
  const eventKey = doc._id?.toHexString() ?? `${doc.mutationId}:${doc.phase}`

  return {
    kind: 'skill' as const,
    eventId: `skill:${eventKey}`,
    ts: doc.createdAt.toISOString(),
    type: 'skill_mutation' as const,
    actor: { userId: doc.actorUserId, teamId: doc.teamId },
    resource: {
      kind: 'skill' as const,
      scope: doc.scope,
      name: doc.skillName,
    },
    mutation: {
      mutationId: doc.mutationId,
      action: doc.action,
      status: doc.status,
      source: doc.source,
      revision: doc.revision,
      changedKeys: doc.changedKeys,
      error: doc.error,
      requestId: doc.requestId,
      conversationId: doc.conversationId,
      toolCallId: doc.toolCallId,
    },
  }
}
