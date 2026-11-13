import { createHash } from 'node:crypto'

import { ObjectId } from 'mongodb'
import { z } from 'zod'

export const MIGRATION_LIMITS = {
  compressedBytes: 100 * 1024 * 1024,
  expandedBytes: 500 * 1024 * 1024,
  records: 100_000,
  recordBytes: 5 * 1024 * 1024,
  skillBytes: 1024 * 1024,
} as const

export const MIGRATION_PARTS = [
  'team.json',
  'members.json',
  'knowledge/instructions.ndjson',
  'knowledge/memories.ndjson',
  'knowledge/skills.ndjson',
  'knowledge/skill-files.ndjson',
  'conversations/sessions.ndjson',
  'conversations/messages.ndjson',
  'work/bots.ndjson',
  'work/plans.ndjson',
  'work/dashboards.ndjson',
  'work/panels.ndjson',
  'work/diagrams.ndjson',
  'work/designs.ndjson',
  'work/triggers.ndjson',
  'work/schedules.ndjson',
  'not-migrated.json',
] as const

export type MigrationPart = (typeof MIGRATION_PARTS)[number]
export type PartDigest = { records: number; bytes: number; sha256: string }
export type MigrationManifest = {
  format: 'nuphos-team'
  formatVersion: 1
  backendVersion: string
  sourceTeamId: string
  exportedAt: string
  parts: Record<string, PartDigest>
  totals: { records: number; bytes: number }
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const text = z.string()
const texts = z.array(text)
const id = text
const mongoId = z.union([text, z.instanceof(ObjectId).transform((value) => value.toHexString())])
const date = z.union([z.date().transform((value) => value.toISOString()), text.datetime()])
const base = { _id: mongoId, createdAt: date, updatedAt: date }
const attribution = { createdBy: text, updatedBy: text.optional() }
const position = z.object({ x: z.number(), y: z.number() })
const playbook = z.object({
  title: text,
  triggerSignals: texts,
  traps: texts,
  doNotUseWhen: texts,
  investigationPath: z.array(z.object({ action: text, check: text, nextWhen: text.optional() })),
})
const capsule = z.object({
  outcome: z.enum(['confirmed', 'partial', 'failed']),
  problem: text,
  rootCause: text.optional(),
  actions: texts,
  verification: texts,
  conversationId: id,
  planId: id.optional(),
  toolCallIds: texts,
  authorUserId: id,
  observedAt: date,
  sourceMemoryIds: texts.optional(),
})
const designObject = z.object({
  id,
  type: z.enum(['frame', 'section', 'text', 'note', 'ink', 'shape']),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number().optional(),
  title: text.optional(),
  text: text.optional(),
  html: text.optional(),
  color: text.optional(),
  fontSize: z.number().optional(),
  strokeWidth: z.number().optional(),
  shape: z.enum(['rect', 'ellipse', 'arrow', 'line']).optional(),
  points: z.array(z.tuple([z.number(), z.number()])).optional(),
})

// Explicit portable fields; nested objects strip unknown fields as well.
export const portableSchemas = {
  instruction: z.object({
    ...base,
    ...attribution,
    title: text,
    content: text,
    enabled: z.boolean(),
  }),
  memory: z.object({
    ...base,
    scope: z.literal('team'),
    type: z.enum(['fact', 'artifact', 'episode']),
    text,
    title: text.optional(),
    keywords: texts.optional(),
    categories: texts,
    source: text,
    conversationId: id.nullable(),
    restrictedToSessionId: id.optional(),
    disabledAt: date.optional(),
    disabledBy: id.optional(),
    disabledReason: text.optional(),
    supersededBy: mongoId.optional(),
  }),
  playbook: z.object({
    ...base,
    ...attribution,
    lineageId: id,
    status: text,
    revision: z.number(),
    gene: playbook,
    capsules: z.array(capsule),
    lastVerifiedAt: date.optional(),
    supersedesId: mongoId.optional(),
  }),
  session: z.object({
    sessionId: id,
    userId: id,
    title: text,
    firstMessage: text,
    createdAt: date,
    lastActiveAt: date,
    archivedAt: date.optional(),
    avatar: text.optional(),
    instructions: text.optional(),
    parentSessionId: id.optional(),
    participantIds: texts.optional(),
    generalAccess: z.enum(['none', 'view', 'reply']).optional(),
    kind: z.literal('channel').optional(),
    agentSessionIds: texts.optional(),
    leadAgentSessionId: id.optional(),
  }),
  message: z.object({
    sessionId: id,
    userId: id,
    messageId: id,
    index: z.number(),
    role: z.enum(['user', 'assistant']),
    metadata: z
      .object({
        version: z.literal(1),
        source: text,
        sentAt: date,
        sourceSessionId: id.optional(),
        sender: z.object({
          type: z.enum(['user', 'agent', 'system']),
          id,
          displayName: text,
          email: text.optional(),
          onBehalfOf: z.object({ id, displayName: text }).optional(),
        }),
        replyTo: z.object({ id: id.optional(), authorName: text, text }).optional(),
      })
      .optional(),
    createdAt: date,
    updatedAt: date,
    parts: z.array(z.unknown()).transform((parts) =>
      parts.flatMap((part) => {
        const parsed = z.object({ type: z.literal('text'), text }).safeParse(part)

        return parsed.success ? [parsed.data] : []
      }),
    ),
  }),
  trigger: z
    .object({
      ...base,
      name: text,
      triggerType: z.enum(['cron', 'webhook']),
      targetSessionId: id,
      cronExpression: text.optional(),
      timeZone: text.optional(),
      messageTemplate: text,
      expiresAt: date.optional(),
      minIntervalSeconds: z.number().optional(),
    })
    .transform((row) => ({ ...row, enabled: false as const })),
  panel: z.object({
    ...base,
    ...attribution,
    dashboardId: mongoId,
    title: text,
    kind: z.enum(['chart', 'scalar', 'table']),
    scriptVersion: z.number(),
    versions: z.array(
      z.object({
        version: z.number(),
        code: text,
        codeHash: text,
        authoredBy: id,
        createdAt: date,
      }),
    ),
  }),
  diagram: z.object({
    ...base,
    name: text,
    nodes: z.array(
      z.object({
        id,
        label: text,
        kind: text.optional(),
        position,
        size: z.object({ width: z.number(), height: z.number() }).optional(),
        url: text.optional(),
      }),
    ),
    views: z.array(
      z.object({
        id,
        name: text,
        edges: z.array(
          z.object({
            id,
            source: id,
            target: id,
            label: text.optional(),
            offset: z.number().optional(),
          }),
        ),
        nodeStyles: z
          .record(z.object({ hidden: z.boolean().optional(), color: text.optional() }))
          .optional(),
      }),
    ),
  }),
  design: z.object({
    ...base,
    ...attribution,
    name: text,
    pages: z.array(
      z.object({
        id,
        name: text,
        objects: z.array(designObject),
        links: z.array(z.object({ id, source: id, target: id, label: text.optional() })),
      }),
    ),
  }),
}
