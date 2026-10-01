import { ObjectId } from 'mongodb'

import { buildCjkSearchText } from '../search-text'

import {
  agentMemories,
  findSecretBearingContent,
  LIVE_RECORD_FILTER,
  memoryTextHash,
} from './shared'

import type { AgentMemoryRecord, AgentMemoryRecordType } from '../types'

export async function createMemoryRecord(input: {
  scope: 'personal' | 'team'
  ownerUserId: string | null
  teamId: string | null
  type: AgentMemoryRecordType
  text: string
  categories?: string[]
  // ADR-0008 track B: authored index line + retrieval keys (see types.ts).
  title?: string | null
  keywords?: string[]
  source: 'save_memory' | 'auto_ingest'
  conversationId?: string | null
  // save_memory only: id of an existing live record in the same pool that
  // this write replaces (ADR-0006 supersede — the no-edit-tool answer).
  // Contract: the store only tombstones; emitting the supersede_correction
  // attribution signal is the CALLER's duty (save_memory's personal branch
  // does via onMemorySuperseded). A future team-record supersede caller must
  // wire the same observer or the negative signal is silently lost.
  supersedes?: string | null
}): Promise<{ ok: true; memoryId: string; existing: boolean } | { ok: false; error: string }> {
  if (input.scope === 'personal' && !input.ownerUserId) {
    return { ok: false, error: 'personal record requires ownerUserId' }
  }
  if (input.scope === 'team' && !input.teamId) {
    return { ok: false, error: 'team record requires teamId' }
  }
  // Title and keywords are persisted, indexed, and later shown to models —
  // the fail-closed gate must scan every stored field, not just the body.
  const secretKinds = findSecretBearingContent({
    text: input.text,
    categories: input.categories,
    title: input.title,
    keywords: input.keywords,
  })

  if (secretKinds) {
    return {
      ok: false,
      error: `Memory contains secret-bearing content (${secretKinds}); remove secrets and reference them indirectly instead.`,
    }
  }
  const textHash = memoryTextHash(input.text)
  const pool =
    input.scope === 'personal'
      ? { scope: 'personal' as const, ownerUserId: input.ownerUserId, teamId: input.teamId }
      : { scope: 'team' as const, teamId: input.teamId }
  let supersededId: ObjectId | null = null

  if (input.supersedes) {
    // Team supersede was refused here while no caller wired the
    // supersede_correction observer, because silently tombstoning a shared
    // record would lose the negative signal. Auto-ingest's contradiction check
    // (memory-native/conflict.ts) earned the path: it records the signal for
    // both scopes before returning. The duty documented above is unchanged and
    // still falls on the caller — a new supersede caller that skips it drops
    // the correction from every retention score.
    if (!ObjectId.isValid(input.supersedes)) {
      return { ok: false, error: 'supersedes must be a memory id from the Saved memories index' }
    }
    // Pool-scoped lookup: a model-supplied id can only ever disable a record
    // this same owner/team could already see.
    const target = await agentMemories().findOne(
      { _id: new ObjectId(input.supersedes), ...pool, ...LIVE_RECORD_FILTER },
      { projection: { _id: 1 } },
    )

    if (!target) {
      return {
        ok: false,
        error: 'supersedes target not found in this memory pool (already removed, or not yours)',
      }
    }
    supersededId = target._id
  }
  {
    // ADR-0006 write gate for every writer (the xtrace importer, the one
    // historical exemption, is gone). Auto-ingest especially needs the
    // tombstone check: without it, knowledge the user deliberately removed
    // (possibly with a reason) would be silently re-learned on the next
    // similar turn.
    const match = await agentMemories().findOne(
      { ...pool, textHash },
      { projection: { _id: 1, disabledAt: 1, disabledBy: 1, disabledReason: 1 } },
    )

    if (match && !match.disabledAt) {
      // Identical live memory: idempotent, no duplicate — but an explicit
      // supersede must still land: the caller asked for old→new replacement
      // and the "new" already exists as this match.
      if (supersededId && !supersededId.equals(match._id)) {
        await agentMemories().updateOne(
          { _id: supersededId, ...LIVE_RECORD_FILTER },
          {
            $set: {
              disabledAt: new Date(),
              disabledBy: input.ownerUserId ?? 'system',
              supersededBy: match._id,
            },
          },
        )
      }

      return { ok: true, memoryId: match._id.toHexString(), existing: true }
    }
    if (match?.disabledAt) {
      // Tombstone: the user removed this content; a later identical save must
      // not silently bring it back (ADR-0005 non-resurrection).
      return {
        ok: false,
        error: `An identical memory was previously removed by the user${
          match.disabledBy ? ` (${match.disabledBy})` : ''
          // The human's stated reason is the strongest signal the model can
          // get here — surface it so the agent understands WHY, not just that.
        }${
          match.disabledReason ? ` with reason: "${match.disabledReason}"` : ''
        } — not re-creating it. If it should come back, restore it from the Memories view instead.`,
      }
    }
  }
  const now = new Date()
  const textSearch = buildCjkSearchText([input.text, input.title, ...(input.keywords ?? [])])
  const doc: AgentMemoryRecord = {
    _id: new ObjectId(),
    scope: input.scope,
    ownerUserId: input.ownerUserId,
    teamId: input.teamId,
    type: input.type,
    text: input.text,
    categories: input.categories ?? [],
    ...(input.title ? { title: input.title } : {}),
    ...(input.keywords?.length ? { keywords: input.keywords } : {}),
    source: input.source,
    conversationId: input.conversationId ?? null,
    textHash,
    ...(textSearch ? { textSearch } : {}),
    createdAt: now,
    updatedAt: now,
  }

  await agentMemories().insertOne(doc)
  if (supersededId) {
    // After the new record exists: the old one tombstones with provenance.
    // A crash between the two writes leaves both live — benign, and the next
    // identical-save dedupe or a manual removal converges it.
    await agentMemories().updateOne(
      { _id: supersededId, ...LIVE_RECORD_FILTER },
      {
        $set: { disabledAt: now, disabledBy: input.ownerUserId ?? 'system', supersededBy: doc._id },
      },
    )
  }

  return { ok: true, memoryId: doc._id.toHexString(), existing: false }
}
