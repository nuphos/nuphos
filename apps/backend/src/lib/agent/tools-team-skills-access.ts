import { z } from 'zod'

import { getTeamMembership } from '@/lib/identity'

import {
  isSkillsStoreConfigured,
  personalSkillsScope,
  teamSkillsScope,
} from './skill-store/service'

export const scopeInput = z
  .enum(['team', 'personal'])
  .optional()
  .describe(
    "`team` (default): the team store every member gets. `personal`: the conversation owner's own skills, loaded only on their turns; works only on the owner's own turn.",
  )

export type SkillScopeName = z.infer<typeof scopeInput>

// Checked on every call rather than by hiding the tools: an agent without the
// tools cannot tell "not allowed" from "not supported" and reports neither.
export async function requireScopeAccess(args: {
  userId: string
  teamId: string
  ownerUserId: string
  scope: SkillScopeName
  write: boolean
}): Promise<{ ok: true; scope: string } | { ok: false; error: string }> {
  const { userId, teamId, scope, write } = args

  if (!isSkillsStoreConfigured()) {
    return { ok: false, error: 'unavailable: this Nuphos server has no team skills store' }
  }
  // Same rule as personal skill delivery: only the owner's own turn, never a guest's.
  if (scope === 'personal' && userId !== args.ownerUserId) {
    return {
      ok: false,
      error:
        "forbidden: personal skills are the conversation owner's and only usable on the owner's own turns",
    }
  }
  if (scope === 'personal' && !/^[a-f0-9]{24}$/u.test(userId)) {
    return { ok: false, error: 'forbidden: this turn has no team member with personal skills' }
  }
  const membership = await getTeamMembership(userId, teamId)

  if (!membership) {
    return { ok: false, error: 'forbidden: you are not a member of this team' }
  }
  if (scope === 'personal') return { ok: true, scope: personalSkillsScope(teamId, userId) }
  if (write && membership.role === 'VIEWER') {
    return { ok: false, error: 'forbidden: VIEWER role cannot create or update team skills' }
  }

  return { ok: true, scope: teamSkillsScope(teamId) }
}
