// Ingest (deliberately duplicates the agent.ts finalizer logic — Phase 2
// swaps the call site; agent.ts stays untouched until then).

import { config } from '@/config'
import { getTeamMembership } from '@/lib/identity'

import { toolActivityFromDigest } from '../memory-slots/turn-digest'

import { findContradictedMemory, logAutoSupersede } from './conflict'
import { distillTurnMemory, mergeAlreadyKnown } from './distill'
import {
  createMemoryRecord,
  listConversationMemoryTitles,
  redactSecretBearingContent,
} from './store'

import type { IngestOutcome, MemoryScope, TurnDigest } from '../memory-slots/types'
import type { DistilledMemory } from './distill'

// Redact-and-save floor: once the masks are stripped, a body that lost more
// than half its characters — or nearly all of them — was ABOUT the secret,
// and a memory of masks teaches nothing. Below either bar the turn keeps the
// hard-reject outcome instead.
const REDACTED_KEEP_RATIO = 0.5
const REDACTED_MIN_TEXT_CHARS = 24

/** Auto-ingest's answer to the store's fail-closed secret gate: the distiller
 * runs once per turn with no retry, so a secret that slipped into the draft
 * must cost the secret, not the whole memory. The explicit save_memory tool
 * path keeps the hard rejection — there the model sees the error and retries
 * in-turn. */
export function redactLearnedMemory(
  memory: DistilledMemory,
):
  | { action: 'keep' }
  | { action: 'save_redacted'; memory: DistilledMemory; kinds: string }
  | { action: 'reject'; kinds: string } {
  const { redacted, kinds } = redactSecretBearingContent({
    title: memory.title,
    text: memory.text,
    categories: memory.categories,
  })

  if (kinds.length === 0) return { action: 'keep' }
  const remaining = redacted.text.replaceAll(/\[REDACTED:[a-z0-9-]+\]/g, '').trim()

  if (
    remaining.length < memory.text.length * REDACTED_KEEP_RATIO ||
    remaining.length < REDACTED_MIN_TEXT_CHARS
  ) {
    return { action: 'reject', kinds: kinds.join(', ') }
  }

  return { action: 'save_redacted', memory: { ...memory, ...redacted }, kinds: kinds.join(', ') }
}

export async function onTurnFinished(
  digest: TurnDigest,
  opts?: { signal?: AbortSignal },
): Promise<IngestOutcome | null> {
  try {
    // Flag off is a bare null — the dispatcher writes NOTHING, keeping the
    // turn row's 'skipped_disabled' default meaning exactly "flag off".
    if (!config.agent.memoryAutoIngest) return null
    // Durable writes are user-origin only (SPI contract). Reported as
    // diagnostics, not null: the dispatcher's denominator must be able to
    // tell "wrong origin" from "disabled" (agent.ts parity).
    if (digest.origin !== 'user') {
      return { saved: [], status: 'completed', diagnostics: { outcome: 'skipped_origin' } }
    }
    // Honor the runtime's ingest budget: bail before the LLM call when the
    // deadline already passed (threading the signal INTO the distiller is a
    // later concern — it carries its own internal timeout today).
    if (opts?.signal?.aborted) return null
    const query = digest.messages.find((m) => m.role === 'user')?.content ?? ''
    const answer = [...digest.messages].reverse().find((m) => m.role === 'assistant')?.content ?? ''
    // What earlier turns of THIS conversation already learned. Fail-open: a
    // read failure must not cost the turn its learning, it only costs dedup.
    const conversationTitles = await listConversationMemoryTitles(digest.conversationId).catch(
      () => [],
    )
    const decision = await distillTurnMemory({
      query,
      answer,
      // NUPS-607: investigation turns hold their durable knowledge in tool
      // results, not in the prose summary. The runtime already redacted and
      // capped this; the distiller treats it as DATA.
      toolActivity: toolActivityFromDigest(digest.messages),
      // Conversation history FIRST, then the turn-scoped hints. The prompt
      // caps alreadyKnown at 12, and what this conversation already saved is
      // the proven source of redundancy, so it wins the slots over
      // recall labels that may be about something else entirely.
      alreadyKnown: mergeAlreadyKnown(conversationTitles, digest.alreadyRecalled ?? []),
      context: {
        userId: digest.userId,
        teamId: digest.teamId,
        sessionId: digest.conversationId,
      },
    })

    if (decision.outcome !== 'learned') {
      return {
        saved: [],
        status: 'completed',
        diagnostics: {
          outcome: decision.outcome,
          // Surface the failure MODE (schema mismatch vs timeout) into the
          // durable snapshot so it is classifiable without log-diving.
          ...(decision.outcome === 'failed' ? { errorName: decision.errorName } : {}),
        },
      }
    }
    if (opts?.signal?.aborted) return null
    const gate = redactLearnedMemory(decision.memory)

    if (gate.action === 'reject') {
      return {
        saved: [],
        status: 'completed',
        diagnostics: {
          outcome: 'rejected',
          reason: `Memory contains secret-bearing content (${gate.kinds}); mostly secrets after redaction, not saved.`,
        },
      }
    }
    const learned = gate.action === 'save_redacted' ? gate.memory : decision.memory
    const redactionDiagnostics: Record<string, string> =
      gate.action === 'save_redacted' ? { redactedKinds: gate.kinds } : {}
    // Same role gate as save_memory's team path: VIEWER (or no team) means
    // the auto-learned knowledge lands in the PERSONAL pool — the learning
    // loop still closes without bypassing the write permission.
    const teamWriteAllowed = digest.teamId
      ? await getTeamMembership(digest.userId, digest.teamId)
          .then((m) => !!m && m.role !== 'VIEWER')
          .catch(() => false)
      : false
    const scope: MemoryScope = teamWriteAllowed ? 'team' : 'personal'
    const categories = [...learned.categories, 'auto-learned']
    // A corrected belief must REPLACE the wrong one, not sit beside it: the
    // distiller sees one turn and would otherwise stack a second opinion the
    // next recall has to arbitrate. Returns null unless the check is enabled
    // and finds a direct conflict, so the default path is unchanged.
    const contradicted = config.agent.memoryConflictSupersede
      ? await findContradictedMemory({
          userId: digest.userId,
          teamId: digest.teamId,
          scope,
          title: learned.title,
          text: learned.text,
          sessionId: digest.conversationId,
        })
      : null
    const saved = await createMemoryRecord({
      ...(contradicted ? { supersedes: contradicted.memoryId } : {}),
      scope,
      ownerUserId: digest.userId,
      teamId: digest.teamId,
      type: learned.type,
      text: learned.text,
      title: learned.title,
      categories,
      source: 'auto_ingest',
      conversationId: digest.conversationId,
    })

    // Secret-gate rejections and textHash dedups are zero-yield for the user,
    // but the outcome stays visible to ops via diagnostics. `reason` feeds the
    // dispatcher's auto_ingest_rejected warn (it redacts + caps before
    // logging), keeping parity with the retired inline finalizer's warn.
    if (!saved.ok) {
      return {
        saved: [],
        status: 'completed',
        diagnostics: { outcome: 'rejected', reason: saved.error },
      }
    }
    // The supersede already landed inside createMemoryRecord (it tombstones
    // before it writes, including on the idempotent existing-match path). What
    // is left is the negative signal, and the runtime owns that: the turnKey it
    // is keyed by lives in the dispatcher, so report the ids and let the
    // dispatcher record it.
    const supersedeDiagnostics: Record<string, string> = contradicted
      ? { supersededMemoryId: contradicted.memoryId, supersededScope: scope }
      : {}

    if (contradicted) {
      logAutoSupersede({
        conversationId: digest.conversationId,
        supersededId: contradicted.memoryId,
        newTitle: learned.title,
        reason: contradicted.reason,
      })
    }
    if (saved.existing) {
      return {
        saved: [],
        status: 'completed',
        diagnostics: { outcome: 'deduped', ...redactionDiagnostics, ...supersedeDiagnostics },
      }
    }
    // Fresh record: both timestamps are the save moment (agent.ts stamps the
    // same "now" pair onto its frame today) — riding them on the event spares
    // the runtime a read-after-write.
    const nowIso = new Date().toISOString()

    return {
      saved: [
        {
          id: saved.memoryId,
          scope,
          kind: 'record',
          title: learned.title,
          action: 'created',
          type: learned.type,
          text: learned.text,
          categories,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
      status: 'completed',
      diagnostics: { outcome: 'saved', ...redactionDiagnostics },
    }
  } catch {
    // Fire-and-forget contract: ingest failures never reject into the caller.
    return null
  }
}
