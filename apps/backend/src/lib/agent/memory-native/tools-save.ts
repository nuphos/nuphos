import { tool } from 'ai'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { DURABLE_KNOWLEDGE_WORDING } from './distill'
import { playbookToItem } from './records-api'
import { createMemoryRecord, createProposal, getTeamMemory, publishProposal } from './store'
import { label, playbookInput, requireEditorAccess } from './tools-shared'

import type { MemoryListItem } from './records-api'
import type { MemorySavedItemObserver, MemorySupersededObserver } from './tools-shared'
import type { AgentTeamMemory, EmbeddedCase } from './types'
import type { AgentSessionOrigin } from '../tools-triggers'

// Resolve a team supersede target pool-scoped to a supersedable status.
// getTeamMemory only returns visible active/needs_review records;
// publishProposal handles the revise-by-lineage operation.
async function resolveTeamSupersedeTarget(
  teamId: string,
  supersedes: string,
): Promise<{ ok: true; memory: AgentTeamMemory } | { ok: false; error: string }> {
  if (!ObjectId.isValid(supersedes)) {
    return { ok: false, error: 'supersedes must be a team memory id from the Memories view' }
  }
  const memory = await getTeamMemory(teamId, supersedes)

  if (!memory) {
    return {
      ok: false,
      error:
        'supersedes target not found in this team (already removed or superseded, or not visible)',
    }
  }

  return { ok: true, memory }
}

export function createSaveMemoryTool(deps: {
  userId: string
  teamId: string | null | undefined
  conversationId: string
  origin: AgentSessionOrigin
  onMemorySavedItem?: MemorySavedItemObserver
  onMemorySuperseded?: MemorySupersededObserver
  getActivePlanId?: () => Promise<string | null>
}) {
  const {
    userId,
    teamId,
    conversationId,
    origin,
    onMemorySavedItem,
    onMemorySuperseded,
    getActivePlanId,
  } = deps

  return tool({
    description:
      // Personal scope states the same durability bar the automatic distiller
      // applies (shared wording — the two write paths must not drift): durable
      // means it spares a future conversation, not that it is secret; skip
      // volatile readings and anything one quick look would re-answer.
      `Save a memory. Always choose \`scope\` explicitly; never infer it from a schema default. scope "personal": a preference or durable fact specific to this user — ${DURABLE_KNOWLEDGE_WORDING} — never a volatile reading, and never something one quick look at the code or config would re-answer — provide \`text\`. ` +
      'scope "team": shared infrastructure state or change, an operational decision, or a reusable investigation strategy, visible to the whole team. Provide `text`, `title`, and `keywords` for a shared fact/change; provide `gene` for a reusable Playbook. Save only concrete, verified outcomes, never guesses. In a team conversation, choose team for shared systems and personal only for user-specific preferences or context. ' +
      'Both scopes take effect immediately; the user (or any teammate, for team memories) can inspect and remove them in the Memories view. ' +
      'Before saving either scope, check the memory indexes in context: if a saved personal memory is now wrong or outdated, save the corrected version with `supersedes` set to the old id instead of stacking a near-duplicate; if a Playbook for the same problem class already exists, load it with memory_get and mention the overlap to the user instead. ' +
      'For personal memories, always provide `title` and `keywords` — they are what future recall finds. Never save a plan approval or an instruction to proceed; the Plan records its own approval, so save what the work established instead. ' +
      'Convert relative dates to absolute dates. Never include credentials, tokens, or secret-bearing configuration — the save is rejected if any are detected.',
    inputSchema: z
      .object({
        label,
        scope: z
          .enum(['personal', 'team'])
          .describe(
            'Required. Use "team" for shared infrastructure, changes, operational decisions, and reusable findings; use "personal" only for user-specific preferences or context.',
          ),
        tags: z.array(z.string().max(40)).max(5).default([]),
        text: z
          .string()
          .min(1)
          .max(2000)
          .optional()
          .describe(
            'For a personal memory or team shared fact/change: the memory itself, self-contained and specific. Omit only when saving a team Playbook with `gene`.',
          ),
        title: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe(
            'For text records in either scope: one-line hook shown in the Saved memories index, same language as the text.',
          ),
        keywords: z
          .array(z.string().min(1).max(40))
          .max(8)
          .default([])
          .describe(
            'For text records in either scope: literal terms a future search would use (service names, error codes). When the conversation language is not English, include BOTH the English and original-language forms of key terms.',
          ),
        type: z.enum(['fact', 'artifact', 'episode']).default('fact'),
        supersedes: z
          .string()
          .optional()
          .describe(
            'id of the outdated memory this one replaces, from the same personal or team memory pool. For a team Playbook, use the Playbook id (EDITOR+ only). The old memory drops out of recall immediately and the correction is recorded as a negative signal against it.',
          ),
        gene: playbookInput
          .optional()
          .describe('scope "team" only: the strategy and its evidence.'),
      })
      .superRefine((value, ctx) => {
        // Team Playbooks use gene.title + triggerSignals; flat records need retrieval hooks.
        if (value.scope === 'team' && value.gene) return
        if (!value.text) {
          ctx.addIssue({
            code: 'custom',
            path: ['text'],
            message: 'text records require `text`; team Playbooks require `gene` instead',
          })
        }
        if (!value.title) {
          ctx.addIssue({
            code: 'custom',
            path: ['title'],
            message: 'text records require `title` (the index line hook)',
          })
        }
        if (value.keywords.length === 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['keywords'],
            message: 'text records require 1-8 retrieval `keywords`',
          })
        }
      }),
    execute: async (input) => {
      if (input.scope === 'team') {
        if (!teamId) {
          return { ok: false, error: 'no team in this conversation — use scope "personal"' }
        }
        const access = await requireEditorAccess(userId, teamId, origin)

        if (!access.ok) return access
        if (input.gene) {
          const target = input.supersedes
            ? await resolveTeamSupersedeTarget(teamId, input.supersedes)
            : null

          if (target && !target.ok) return target
          const supersedesMemory = target?.memory ?? null
          // Proposal + immediate publish: the pair keeps the audit trail and
          // the idempotency/secret gates of the proposal path, without a
          // confirmation pause (ADR-0005: default-enabled, post-hoc control).
          const playbookDraft = {
            title: input.gene.title,
            triggerSignals: input.gene.triggerSignals,
            investigationPath: input.gene.investigationPath,
            traps: input.gene.traps,
            doNotUseWhen: input.gene.doNotUseWhen,
          }
          const activePlanId = (await getActivePlanId?.()) ?? null
          const caseDraft: EmbeddedCase = {
            outcome: 'confirmed',
            problem: input.gene.evidence.problem,
            ...(input.gene.evidence.rootCause ? { rootCause: input.gene.evidence.rootCause } : {}),
            actions: input.gene.evidence.actions,
            verification: input.gene.evidence.verification,
            conversationId,
            ...(activePlanId ? { planId: activePlanId } : {}),
            toolCallIds: [],
            authorUserId: userId,
            observedAt: new Date(),
          }
          const proposal = await createProposal({
            teamId,
            userId,
            conversationId,
            playbook: playbookDraft,
            caseRecord: caseDraft,
            ...(supersedesMemory ? { supersedesMemoryId: supersedesMemory._id } : {}),
          })

          if (!proposal.ok) return proposal
          const published = await publishProposal({
            teamId,
            userId,
            proposalId: proposal.proposalId,
          })

          if (!published.ok) return published
          // Emit only when publish actually retired the prior revision. The
          // request-time target can stop being live before publish re-checks it.
          if (published.supersededMemoryId) {
            onMemorySuperseded?.(published.supersededMemoryId, 'team')
          }
          // The desktop chip must not depend on a read-after-write of the doc
          // we just published (review F6: transient replica lag silently
          // dropped it). Prefer the fresh read; fall back to the draft fields
          // we already hold — for a re-published existing playbook the timestamps
          // are approximate, which a feedback chip can tolerate.
          const memory =
            (await getTeamMemory(teamId, published.memoryId)) ??
            ({
              _id: new ObjectId(published.memoryId),
              teamId,
              lineageId: published.memoryId,
              status: 'active',
              revision: 1,
              gene: playbookDraft,
              capsules: [caseDraft],
              createdBy: userId,
              createdAt: caseDraft.observedAt,
              updatedBy: userId,
              updatedAt: caseDraft.observedAt,
            } satisfies AgentTeamMemory)
          const playbookItem = playbookToItem(memory)

          onMemorySavedItem?.({ scope: 'team', item: playbookItem, title: memory.gene.title })

          return {
            ok: true,
            scope: 'team',
            memoryId: published.memoryId,
            title: published.title,
            message:
              `Published team memory "${published.title}". ` +
              'It is live for the whole team now; teammates can inspect or remove it in the Memories view.',
          }
        }
      }

      // Flat record: personal preference/context, or a shared team fact/change.
      if (origin !== 'user') {
        return { ok: false, error: `forbidden: ${origin}-origin turns cannot save memories` }
      }
      if (!input.text) {
        return {
          ok: false,
          error:
            input.scope === 'team'
              ? 'scope "team" requires `text` for a shared fact/change or `gene` for a Playbook'
              : 'scope "personal" requires `text`',
        }
      }
      const recordScope = input.scope
      const result = await createMemoryRecord({
        scope: recordScope,
        ownerUserId: recordScope === 'personal' ? userId : null,
        teamId: teamId ?? null,
        type: input.type,
        text: input.text,
        categories: input.tags,
        title: input.title ?? null,
        keywords: input.keywords,
        source: 'save_memory',
        conversationId,
        supersedes: input.supersedes ?? null,
      })

      if (!result.ok) return result
      // Supersede landed (both the new-insert and identical-existing paths
      // tombstone the old record) — unless the "new" IS the old record, in
      // which case nothing was corrected.
      if (input.supersedes && result.memoryId !== input.supersedes) {
        onMemorySuperseded?.(input.supersedes, recordScope)
      }
      if (result.existing) {
        return {
          ok: true,
          scope: recordScope,
          memoryId: result.memoryId,
          message: 'An identical memory is already saved — nothing new was written.',
        }
      }
      const now = new Date().toISOString()
      const recordItem: MemoryListItem = {
        id: result.memoryId,
        type: input.type,
        ...(input.title ? { title: input.title } : {}),
        text: input.text,
        categories: input.tags,
        createdAt: now,
        updatedAt: now,
        convId: conversationId,
        userId,
        appId: null,
        groupIds: [],
      }

      onMemorySavedItem?.({
        scope: recordScope,
        item: recordItem,
        title: input.title ?? undefined,
      })

      return { ok: true, scope: recordScope, memoryId: result.memoryId }
    },
  })
}
