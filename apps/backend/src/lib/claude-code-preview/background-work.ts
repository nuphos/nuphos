import { consumeConversationWorkLost, markConversationWorkLost } from '@/lib/agent/db'

import type { BackgroundWorkLoss } from '@/lib/agent/db'
import type { TeamSession } from './team-openab-runtime'

/**
 * Said when the inner agent session is known to be gone: a resume answered
 * that it no longer exists, or this turn had to create a new one. Without it
 * a monitor the agent armed dies unannounced and it keeps waiting.
 */
export const BACKGROUND_WORK_LOST_NOTICE =
  'The process that ran those earlier turns was replaced. Anything it left running — ' +
  'background tasks, monitors, watchers, open shells, any wait you armed — died with it ' +
  'and will never report back. If you told the user you were watching something, check it ' +
  'now, say what you found, and either keep the check inside this turn or tell the user ' +
  'plainly that nothing is watching it any more.'

/**
 * Said when Nuphos only lost contact. The process may well have survived, so
 * the agent is told to check before repeating anything that already had an
 * effect, rather than to re-run on the assumption of death.
 */
export const BACKGROUND_WORK_UNCERTAIN_NOTICE =
  'Nuphos lost contact with the runtime that ran those earlier turns and could not get back ' +
  'on. Anything it left running — background tasks, monitors, watchers, open shells, any wait ' +
  'you armed — may have died with it and may never report back. Before re-running anything ' +
  'that has side effects, check whether it already happened. If you told the user you were ' +
  'watching something, say where it actually stands, and either keep the check inside this ' +
  'turn or tell the user plainly that nothing is watching it any more.'

export function backgroundWorkNotice(uncertain: boolean): string {
  return uncertain ? BACKGROUND_WORK_UNCERTAIN_NOTICE : BACKGROUND_WORK_LOST_NOTICE
}

/**
 * Records the loss against the conversation, where it survives both the
 * in-memory session object and the replica that observed it. Returns true so
 * a caller that detects it mid-turn can fold it into `fresh` in one
 * expression, while the record outlives a turn cancelled before it reports.
 */
export async function markBackgroundWorkLost(
  session: TeamSession,
  reason: BackgroundWorkLoss,
): Promise<boolean> {
  await markConversationWorkLost(session.conversationId, session.teamId, reason)

  return true
}

/**
 * What this conversation knows about background work dying since its last
 * prompt: `session_lost` when a resume said the inner session is gone,
 * `unreachable` when reattachment gave up without ever getting an answer.
 */
export async function consumeBackgroundWorkLost(
  session: TeamSession,
): Promise<BackgroundWorkLoss | null> {
  const recorded = await consumeConversationWorkLost(session.conversationId, session.teamId)
  const observed = session.innerSessionLost

  session.innerSessionLost = false
  if (observed || recorded === 'session_lost') return 'session_lost'

  return recorded
}

/**
 * The text to prompt with, once this turn knows whether its inner session is
 * new and what became of the conversation's background work. The mark is
 * consumed here, after runtime admission, so a refused turn keeps it pending.
 */
export async function backgroundWorkPrompt(
  session: TeamSession,
  fresh: boolean,
  args: { message: string; freshSessionMessage?: (uncertain?: boolean) => string },
): Promise<string> {
  const lost = await consumeBackgroundWorkLost(session)

  if (!args.freshSessionMessage || !(fresh || lost)) return args.message

  // A session this turn had to create is confirmed new, whatever a pending
  // mark only suspected.
  return args.freshSessionMessage(!fresh && lost === 'unreachable')
}
