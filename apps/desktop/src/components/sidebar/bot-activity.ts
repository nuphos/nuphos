import { attentionInputRequests, botIsOnboarding } from '../../lib/agentInputRequests.ts'
import { chatRowIndicator, runtimeTurnActive } from '../../lib/runtimeExecution.ts'
import { subAgentState } from '../../lib/subAgentState.ts'

import type { AgentConversation } from '../../api/agent-types.ts'
import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'

export type Run = { conversation: AgentConversation; runtimeState: RuntimeExecution | undefined }

/** What a Bot is doing: a question, its turn, a sub-agent's, its setup, then background work. */
export type Activity =
  | { kind: 'idle' }
  | { kind: 'onboarding' }
  | { kind: 'asking'; question: string }
  | { kind: 'working'; run: Run }
  | { kind: 'background'; run: Run | undefined }
  | { kind: 'error'; label?: string }

export function activityOf(bot: Run | undefined, kids: Run[]): Activity {
  const runs = [...(bot ? [bot] : []), ...kids]
  const asking = runs.find((run) => attentionInputRequests(run.conversation).length > 0)

  if (asking)
    return {
      kind: 'asking',
      question: attentionInputRequests(asking.conversation)[0]?.question ?? '',
    }
  if (bot && runtimeTurnActive(bot.runtimeState)) return { kind: 'working', run: bot }
  const busy = kids.find((kid) => runtimeTurnActive(kid.runtimeState))

  if (busy) return { kind: 'working', run: busy }
  // A Bot still in setup says so only while nothing runs: a working Bot shows it works.
  if (
    bot &&
    botIsOnboarding(bot.conversation) &&
    chatRowIndicator(bot.runtimeState, false) !== 'error'
  )
    return { kind: 'onboarding' }
  const indicator = chatRowIndicator(bot?.runtimeState, false)

  if (indicator === 'error') return { kind: 'error', label: bot?.runtimeState?.label }
  if (
    indicator === 'background' ||
    kids.some((kid) => subAgentState(kid.conversation, kid.runtimeState) === 'running')
  )
    return {
      kind: 'background',
      run:
        kids.find((kid) => subAgentState(kid.conversation, kid.runtimeState) === 'running') ?? bot,
    }

  return { kind: 'idle' }
}
