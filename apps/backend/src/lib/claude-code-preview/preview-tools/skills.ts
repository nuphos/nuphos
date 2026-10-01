// Skill authoring remains a Nuphos capability. Skill discovery/loading does
// not: merged skills are materialized into `.claude/skills` before the ACP
// session starts and Claude Code handles them natively.
import { createTeamSkillTools } from '@/lib/agent/tools-team-skills'
import { logError } from '@/lib/observability'

import type { PreviewToolContext } from '../preview-tool-context'

export async function skillToolSet(ctx: PreviewToolContext): Promise<Record<string, unknown>> {
  // A skills-store outage degrades to no authoring tools; installed native
  // skills and the rest of nuphos-tools remain available.
  try {
    return await createTeamSkillTools(ctx.userId, ctx.teamId, 'user', {
      conversationId: ctx.sessionId,
    })
  } catch (err) {
    logError('claude_code.preview_tools.skills_unavailable', err, { team_id: ctx.teamId })

    return {}
  }
}
