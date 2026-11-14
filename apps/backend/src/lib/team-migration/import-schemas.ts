import { z } from 'zod'

import { OPENAB_PROVIDERS } from '@/lib/claude-code-preview/runtime-provider'
import { HOME_METRIC_KINDS } from '@/models/team'

import { MIGRATION_LIMITS, MIGRATION_PARTS, portableSchemas } from './format'

const text = z.string()
const id = text.min(1)
const date = text.datetime()
const objectId = text.regex(/^[a-f0-9]{24}$/)
const role = z.enum(['ADMINISTRATOR', 'EDITOR', 'VIEWER'])
const part = z
  .object({
    records: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    sha256: text.regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const manifestSchema = z
  .object({
    format: z.literal('nuphos-team'),
    formatVersion: z.literal(1),
    backendVersion: text.min(1),
    sourceTeamId: objectId,
    exportedAt: date,
    parts: z
      .record(part)
      .refine(
        (value) =>
          Object.keys(value).length === MIGRATION_PARTS.length &&
          MIGRATION_PARTS.every((name) => Object.hasOwn(value, name)),
      ),
    totals: z
      .object({
        records: z.number().int().nonnegative().max(MIGRATION_LIMITS.records),
        bytes: z.number().int().nonnegative().max(MIGRATION_LIMITS.expandedBytes),
      })
      .strict(),
  })
  .strict()

export const membersSchema = z.array(
  z
    .object({
      sourceUserId: objectId,
      name: text,
      email: text.email().nullable(),
      role,
      joinedAt: date,
      removedAt: date.nullable(),
    })
    .strict(),
)
const cell = z
  .object({ i: text, x: z.number(), y: z.number(), w: z.number(), h: z.number() })
  .strict()

export const teamSchema = z
  .object({
    sourceTeamId: objectId,
    name: text.trim().min(1).max(80),
    allowedEmailDomains: z.array(text),
    agentRuntime: z.enum([...OPENAB_PROVIDERS, 'nuphos']).optional(),
    localAgentSharing: z.enum(['off', 'approve', 'full']).optional(),
    homeLayout: z
      .object({
        team: z.boolean(),
        panels: z.array(z.object({ dashboardId: objectId, panelId: objectId }).strict()),
        metrics: z
          .array(
            z
              .object({
                id,
                kind: z.enum(HOME_METRIC_KINDS),
                range: z.enum(['1d', '7d', '30d']),
                scope: z.enum(['me', 'team']),
              })
              .strict(),
          )
          .optional(),
        grid: z.array(cell).optional(),
        gridVersion: z.number().int().optional(),
      })
      .strict()
      .nullable(),
  })
  .strict()
const step = z
  .object({
    title: text,
    description: text.optional(),
    jobs: z.array(
      z
        .object({
          title: text,
          description: text.optional(),
          commands: z
            .array(
              z
                .object({
                  command: text,
                  description: text.optional(),
                  status: z.literal('pending'),
                })
                .strict(),
            )
            .optional(),
        })
        .strict(),
    ),
  })
  .strict()
const plan = z
  .object({
    id,
    number: z.number().int().positive(),
    createdBy: objectId,
    sourceConversationId: id.optional(),
    title: text,
    overview: text.optional(),
    decisions: z.array(z.object({ label: text, value: text }).strict()).optional(),
    steps: z.array(step),
    costSummary: text.optional(),
    costOneTime: text.optional(),
    costMonthly: text.optional(),
    costSavings: text.optional(),
    riskWorstCase: text.optional(),
    riskMitigations: z.array(text).optional(),
    status: z.literal('proposed'),
    createdAt: date,
    updatedAt: date,
  })
  .strict()
  .refine((row) => row.id === String(row.number))
const dashboard = z
  .object({
    id: objectId,
    teamId: objectId,
    name: text,
    layout: z.array(
      z
        .object({ panelId: objectId, x: z.number(), y: z.number(), w: z.number(), h: z.number() })
        .strict(),
    ),
    timeRange: z
      .object({
        periodStart: date,
        periodEnd: date,
        granularity: z.enum(['day', 'week', 'month']).nullable(),
      })
      .strict(),
    rangePreset: z.enum(['last7', 'last14', 'last30', 'thisMonth', 'prevMonth']).nullable(),
    cadence: z.enum(['daily', 'weekly', 'monthly']).nullable(),
    createdBy: objectId,
    createdAt: date,
    updatedAt: date,
  })
  .strict()
const skillMetadata = z
  .object({
    createdAt: date.nullable(),
    createdByUserId: objectId.nullable(),
    createdSource: text,
    updatedAt: date.nullable(),
    updatedByUserId: objectId.nullable(),
    updatedSource: text,
    revision: z.number().int().nonnegative(),
    status: z.enum(['active', 'deleted']),
    deletedAt: date.nullable(),
    deletedByUserId: objectId.nullable(),
    legacy: z.boolean(),
  })
  .strict()
const exclusions = z.array(
  z
    .object({
      category: text,
      sourceId: text.optional(),
      label: text.optional(),
      reason: text,
      nextAction: text,
    })
    .strict(),
)

export const importSchemas: Record<string, z.ZodTypeAny> = {
  'team.json': teamSchema,
  'members.json': membersSchema,
  'not-migrated.json': exclusions,
  'knowledge/instructions.ndjson': portableSchemas.instruction.extend({ _id: objectId }),
  'knowledge/memories.ndjson': z.discriminatedUnion('kind', [
    portableSchemas.memory.extend({
      kind: z.literal('record'),
      _id: objectId,
      supersededBy: objectId.optional(),
    }),
    portableSchemas.playbook.extend({
      kind: z.literal('playbook'),
      _id: objectId,
      supersedesId: objectId.optional(),
    }),
  ]),
  'knowledge/skills.ndjson': z
    .object({
      name: text.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
      metadata: skillMetadata.nullable(),
    })
    .strict(),
  'knowledge/skill-files.ndjson': z
    .object({
      key: text,
      text: text.refine(
        (value) => Buffer.byteLength(value) <= MIGRATION_LIMITS.skillBytes && !value.includes('\0'),
      ),
      sha256: text.regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  'conversations/sessions.ndjson': portableSchemas.session,
  'conversations/messages.ndjson': portableSchemas.message,
  'work/bots.ndjson': z.object({ sessionId: id }).strict(),
  'work/plans.ndjson': plan,
  'work/dashboards.ndjson': dashboard,
  'work/panels.ndjson': portableSchemas.panel.extend({ _id: objectId, dashboardId: objectId }),
  'work/diagrams.ndjson': portableSchemas.diagram.extend({ _id: objectId }),
  'work/designs.ndjson': portableSchemas.design.extend({ _id: objectId }),
  'work/triggers.ndjson': portableSchemas.trigger
    .innerType()
    .extend({ _id: objectId, enabled: z.literal(false) })
    .strict(),
  'work/schedules.ndjson': z.never(),
}
