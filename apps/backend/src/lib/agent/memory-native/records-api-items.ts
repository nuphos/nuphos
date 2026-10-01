import { ObjectId } from 'mongodb'

import type { MemoryListItem } from './records-api-types'
import type { AgentMemoryRecord, AgentTeamMemory } from './types'

// Rejected/superseded playbooks are tombstones: invisible to the read API so a
// deleted playbook cannot resurrect in the list (review finding).
export const VISIBLE_PLAYBOOK_STATUSES = ['active', 'needs_review'] as const

export const DEFAULT_LIMIT = 50

const CURSOR_PREFIX = 'native-memory:'

// ── Cursor (composite keyset over the two team-scope sources) ───────────
// Mirrors the xtrace-era composite-cursor pattern the client already
// tolerates: opaque string, null when exhausted, garbage resets to page 1.

type SourceCursor = { t: string; id: string } | null

export type NativeCursor = {
  g: SourceCursor // playbooks, keyset on (updatedAt desc, _id desc)
  gd: boolean
  r: SourceCursor // flat records, keyset on (createdAt desc, _id desc)
  rd: boolean
}

const START_CURSOR: NativeCursor = { g: null, gd: false, r: null, rd: false }

export function parseNativeMemoryCursor(cursor: string | undefined): NativeCursor {
  if (!cursor?.startsWith(CURSOR_PREFIX)) return { ...START_CURSOR }
  try {
    const parsed = JSON.parse(decodeURIComponent(cursor.slice(CURSOR_PREFIX.length)))

    return {
      g: parsed.g ?? null,
      gd: Boolean(parsed.gd),
      r: parsed.r ?? null,
      rd: Boolean(parsed.rd),
    }
  } catch {
    return { ...START_CURSOR }
  }
}

export function encodeNativeMemoryCursor(cursor: NativeCursor): string | null {
  if (cursor.gd && cursor.rd) return null

  return `${CURSOR_PREFIX}${encodeURIComponent(JSON.stringify(cursor))}`
}

export function keysetFilter(
  field: 'createdAt' | 'updatedAt',
  after: SourceCursor,
): Record<string, unknown> {
  if (!after || !ObjectId.isValid(after.id)) return {}
  const t = new Date(after.t)

  // A garbage timestamp in an otherwise well-formed cursor must reset to
  // page 1, not flow an Invalid Date into the Mongo query and 500 the list.
  if (Number.isNaN(t.getTime())) return {}

  return {
    $or: [{ [field]: { $lt: t } }, { [field]: t, _id: { $lt: new ObjectId(after.id) } }],
  }
}

// ── DTO mapping ─────────────────────────────────────────────────────────

export function recordToItem(r: AgentMemoryRecord): MemoryListItem {
  return {
    id: r._id.toHexString(),
    type: r.type,
    ...(r.title ? { title: r.title } : {}),
    text: r.text,
    categories: r.categories,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    convId: r.conversationId,
    userId: r.ownerUserId,
    appId: null,
    groupIds: [],
    ...(r.disabledAt ? { disabledAt: r.disabledAt.toISOString() } : {}),
    ...(r.disabledBy ? { disabledBy: r.disabledBy } : {}),
    ...(r.disabledReason ? { disabledReason: r.disabledReason } : {}),
  }
}

export function playbookToItem(
  m: AgentTeamMemory,
  opts: { includeCapsules?: boolean } = {},
): MemoryListItem {
  const g = m.gene
  // Tolerate missing arrays (direct-store writes, legacy docs): one malformed
  // playbook must degrade to a sparse item, not 500 the whole list route.
  const steps = (g.investigationPath ?? [])
    .map((s, i) => {
      const nextWhen = s.nextWhen ? ` (next when: ${s.nextWhen})` : ''

      return `${String(i + 1)}. ${s.action} — ${s.check}${nextWhen}`
    })
    .join('\n')
  const trapLines = (g.traps ?? []).map((t) => `- ${t}`).join('\n')
  const traps = g.traps?.length ? `\nTraps:\n${trapLines}` : ''
  const doNotUseLines = (g.doNotUseWhen ?? []).map((d) => `- ${d}`).join('\n')
  const doNotUse = g.doNotUseWhen?.length ? `\nDo not use when:\n${doNotUseLines}` : ''

  return {
    id: m._id.toHexString(),
    type: 'artifact',
    text: `${g.title}\n\nSignals: ${(g.triggerSignals ?? []).join(', ')}\nInvestigation path:\n${steps}${traps}${doNotUse}`,
    // No 'gene' label: internal vocabulary stays off user surfaces (naming
    // discipline — the Track B rename decides the public word). The type
    // column ('artifact') already distinguishes these from plain records;
    // only non-default status still surfaces.
    categories: m.status !== 'active' ? [m.status] : [],
    ...(m.rejectedReason ? { disabledReason: m.rejectedReason } : {}),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    convId: m.capsules[0]?.conversationId ?? null,
    userId: m.createdBy,
    appId: null,
    groupIds: [],
    gene: {
      title: g.title ?? '',
      triggerSignals: g.triggerSignals ?? [],
      investigationPath: (g.investigationPath ?? []).map((s) => ({
        action: s.action,
        check: s.check,
        ...(s.nextWhen ? { nextWhen: s.nextWhen } : {}),
      })),
      traps: g.traps ?? [],
      doNotUseWhen: g.doNotUseWhen ?? [],
      status: m.status,
      ...(typeof m.revision === 'number' ? { revision: m.revision } : {}),
      ...(opts.includeCapsules
        ? {
            capsules: (m.capsules ?? []).map((c) => ({
              outcome: c.outcome,
              problem: c.problem,
              ...(c.rootCause ? { rootCause: c.rootCause } : {}),
              actions: c.actions ?? [],
              verification: c.verification ?? [],
              conversationId: c.conversationId,
              ...(c.planId ? { planId: c.planId } : {}),
              observedAt: c.observedAt.toISOString(),
            })),
          }
        : {}),
    },
  }
}
