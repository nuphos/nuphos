import { setConversationPromptSuggestion } from '@/lib/agent/db'

import { storeSessionConfig } from './session-config-record'

import type { SessionConfigOption } from './session-config-options'
import type { TeamSession } from './team-openab-runtime'

export type SessionReport =
  | { kind: 'prompt-suggestion'; suggestion: string }
  | { kind: 'session-config'; options: SessionConfigOption[] }

/** Keeps what a session reports about itself: the next prompt's suggestion, and the
 *  settings it runs, which are the agent's own doing (#3789). */
export async function storeSessionReport(
  session: Pick<TeamSession, 'conversationId' | 'teamId' | 'openabSessionId'>,
  report: SessionReport,
) {
  if (report.kind === 'prompt-suggestion')
    await setConversationPromptSuggestion(session.conversationId, session.teamId, report.suggestion)
  else
    await storeSessionConfig(
      session.conversationId,
      session.teamId,
      session.openabSessionId,
      report.options,
      { actorId: 'system', via: 'runtime_reported' },
    )
}
