import { openInputRequests } from '../../lib/agentInputRequests.ts'
import { runtimeTypingIn, runtimeTurnActive } from '../../lib/runtimeExecution.ts'
import { subAgentState } from '../../lib/subAgentState.ts'
import { activityOf } from '../sidebar/bot-activity.ts'

import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'
import type { Run } from '../sidebar/bot-activity.ts'

/** What a run is doing right now, as specific as its runtime says. */
export type Step =
  { kind: 'command'; command: string } | { kind: 'tool'; title: string } | { kind: 'thinking' }

/**
 * What a Bot's chat says the Bot is doing, from the same reading as its row in
 * the sidebar. Null when the Bot rests, or its row says something else (failed).
 */
export type BotWork =
  | { kind: 'turn'; step: Step; reason: 'chat' | 'report' | 'other'; kids: Run[] }
  | { kind: 'waiting'; kids: Run[] }
  | { kind: 'background'; kids: Run[] }
  | { kind: 'asking'; question: string; kids: Run[] }

const RUNNING = new Set(['running', 'in_progress', 'pending'])

/** The run's current step: a command in a shell, then a tool. */
export function stepOf(runtimeState: RuntimeExecution | undefined): Step {
  const tools = [...(runtimeState?.tools ?? [])].reverse()
  const shell = tools.find((tool) => tool.terminal?.status === 'running' && tool.terminal.command)

  if (shell?.terminal?.command) return { kind: 'command', command: oneLine(shell.terminal.command) }
  const tool = tools.find((item) => RUNNING.has(item.status ?? '') && item.title)

  if (tool?.title) return { kind: 'tool', title: oneLine(tool.title) }

  return { kind: 'thinking' }
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The sub-agents still at work or asking, in their listed order. */
export function activeKids(kids: Run[]): Run[] {
  return kids.filter((kid) => subAgentState(kid.conversation, kid.runtimeState) !== 'done')
}

/**
 * Why the Bot's own turn runs: a post in this chat, a sub-agent's report (the
 * Bot's newest message came from one of its sub-agents), or something else,
 * such as a schedule.
 */
function reasonOf(bot: Run, kids: Run[], channelId: string): 'chat' | 'report' | 'other' {
  if (runtimeTypingIn(bot.runtimeState, channelId)) return 'chat'
  const from = bot.conversation.lastMessage?.from

  return from && kids.some((kid) => kid.conversation.title === from) ? 'report' : 'other'
}

export function botWorkOf(bot: Run | undefined, kids: Run[], channelId: string): BotWork | null {
  const activity = activityOf(bot, kids)
  const working = activeKids(kids)

  if (activity.kind === 'asking')
    return { kind: 'asking', question: activity.question, kids: working }
  if (
    activity.kind === 'working' &&
    bot &&
    activity.run === bot &&
    runtimeTurnActive(bot.runtimeState)
  )
    return {
      kind: 'turn',
      // The Bot's own words are already the chat's latest post; its tools say more.
      step: stepOf(bot.runtimeState),
      reason: reasonOf(bot, kids, channelId),
      kids: working,
    }
  if (activity.kind === 'working') return { kind: 'waiting', kids: working }
  if (activity.kind === 'background')
    return working.length > 0
      ? { kind: 'waiting', kids: working }
      : { kind: 'background', kids: [] }

  return null
}

/**
 * When a run's reply started, as the chat list says. The backend's own runs give
 * an ISO time, the shared run store epoch milliseconds; anything else is unknown.
 */
export function runStartedAt(run: Run | undefined): number | undefined {
  const raw = run?.conversation.activeRun?.startedAt?.trim()

  if (!raw) return undefined
  const at = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw)

  return Number.isFinite(at) && at > 0 ? at : undefined
}

const earliest = (times: (number | undefined)[]) => {
  const known = times.filter((time): time is number => time !== undefined)

  return known.length > 0 ? Math.min(...known) : undefined
}

/**
 * When the Bot took up this work, from the runs themselves, so it reads the same
 * from anywhere and does not start over when the chat is opened. Undefined when
 * no run says: the row then shows no time rather than a wrong one.
 */
export function workSince(
  work: BotWork | null,
  bot: Run | undefined,
  kids: Run[],
): number | undefined {
  if (!work) return undefined
  if (work.kind === 'turn') return runStartedAt(bot)
  if (work.kind === 'waiting') return earliest(work.kids.map(runStartedAt))
  if (work.kind === 'asking')
    return earliest(
      [...(bot ? [bot] : []), ...kids].flatMap((run) =>
        openInputRequests(run.conversation).map(
          (request) => Date.parse(request.askedAt) || undefined,
        ),
      ),
    )

  return undefined
}
