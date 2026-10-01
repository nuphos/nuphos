import { z } from 'zod'

import { getTeamMembership } from '@/lib/identity'

import type { MemoryListItem } from './records-api'
import type { AgentSessionOrigin } from '../tools-triggers'

// Decision: EDITOR+ may write team memory; VIEWER is read-only (get);
// trigger-origin turns may never write team memory.
export async function requireEditorAccess(
  userId: string,
  teamId: string,
  origin: AgentSessionOrigin,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (origin !== 'user') {
    return { ok: false, error: `forbidden: ${origin}-origin turns cannot write team memory` }
  }
  const membership = await getTeamMembership(userId, teamId)

  if (!membership) {
    return { ok: false, error: 'forbidden: you are not a member of this team' }
  }
  if (membership.role === 'VIEWER') {
    return { ok: false, error: 'forbidden: VIEWER role cannot write team memory' }
  }

  return { ok: true }
}

export const label = z
  .string()
  .min(1)
  .max(160)
  .describe('Short human-readable description of this single action, shown to the user as a step.')

const investigationStep = z.object({
  action: z.string().describe('What to do at this step.'),
  check: z.string().describe('What result to check for.'),
  nextWhen: z.string().optional().describe('Condition that leads to the next step.'),
})

// Team payload: the whole Playbook + evidence Case folded into one object, so
// the top-level save_memory schema stays flat (scope / tags / text / gene —
// the model-facing input field keeps its legacy `gene` name)
// while the team-side complexity keeps a single boundary.
export const playbookInput = z.object({
  title: z.string().min(1).max(200).describe('One-line strategy name, same language as the team.'),
  triggerSignals: z
    .array(z.string())
    .min(1)
    .max(10)
    .describe(
      'Short literal keywords likely to appear in future problem reports (error codes, resource kinds, provider names).',
    ),
  investigationPath: z.array(investigationStep).min(1).max(10),
  traps: z.array(z.string()).max(10).describe('Plausible-looking paths that are actually wrong.'),
  doNotUseWhen: z.array(z.string()).max(10),
  evidence: z.object({
    problem: z
      .string()
      .describe('Sanitized one-paragraph problem statement from this conversation.'),
    rootCause: z.string().optional(),
    actions: z.array(z.string()).min(1).describe('Sanitized actions that resolved it.'),
    verification: z
      .array(z.string())
      .min(1)
      .describe('How success was verified (objective postconditions).'),
  }),
})

export type MemorySavedItemObserver = (info: {
  scope: 'personal' | 'team'
  item: MemoryListItem
  /** The real one-line label (personal `input.title`, playbook gene title).
   * Kept separately for provider events; legacy/external MemoryListItems may
   * still omit their additive title field. */
  title?: string
}) => void

export type MemoryFetchedObserver = (
  memoryId: string,
  kind: 'gene' | 'record',
  scope: 'personal' | 'team',
  label: string,
) => void

export type MemorySupersededObserver = (memoryId: string, scope: 'personal' | 'team') => void

export type MemorySearchedObserver = (info: {
  query: string
  hitCount: number
  playbookHitCount: number
}) => void
