import { openInputRequests } from '../../lib/agentInputRequests.ts'
import { threadStatusOf } from '../agent/panel/threadStatus.ts'

import type { AgentConversation } from '../../api/agent-types.ts'
import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'
import type { ThreadStatus } from '../agent/panel/threadStatus.ts'

/** The Tasks a Bot started in one turn of its chat, and where their card sits in the timeline. */
export type DelegatedRound = { key: string; at: number; tasks: AgentConversation[] }

const startedAt = (task: AgentConversation) => Date.parse(task.createdAt) || 0

/**
 * The Bot's Tasks by the turn that started them, oldest first. A turn starts at
 * a post from someone other than the Bot (`turns`, their times); its card sits
 * after everything in that turn, so under the Bot's last message in it.
 *
 * Every turn keeps its card. To show only the newest, return `rounds.slice(-1)`.
 */
export function delegatedRounds(tasks: AgentConversation[], turns: number[]): DelegatedRound[] {
  const starts = [...turns].sort((a, b) => a - b)
  const rounds = new Map<number, AgentConversation[]>()

  for (const task of [...tasks].sort((a, b) => startedAt(a) - startedAt(b))) {
    // The turn it was started in: the last one that began before it, -1 before any.
    const turn = starts.findLastIndex((start) => start <= startedAt(task))

    rounds.set(turn, [...(rounds.get(turn) ?? []), task])
  }

  return [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([turn, round]) => ({
      key: `delegated-${round[0].sessionId}`,
      // Just before the next turn's first post; the newest turn's card stays last.
      at: turn + 1 < starts.length ? starts[turn + 1] - 0.5 : Number.MAX_SAFE_INTEGER,
      tasks: round,
    }))
}

/** Where a Task stands, in a Task badge's states. A Task the list holds no state for has ended. */
export function taskStatus(
  task: Pick<AgentConversation, 'inputRequests'>,
  runtimeState: RuntimeExecution | undefined,
): ThreadStatus {
  if (openInputRequests(task).length > 0) return 'waiting'

  return runtimeState ? threadStatusOf(runtimeState) : 'done'
}

const letters = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 40)

/**
 * The Task's newest message, as the list previews it. Empty while that is still
 * the prompt it was handed: the prompt is not progress.
 */
export function taskSaid(task: Pick<AgentConversation, 'firstMessage' | 'lastMessage'>): string {
  const said = task.lastMessage?.text.trim() ?? ''

  return said && letters(said) !== letters(task.firstMessage) ? said : ''
}

/** The first sentence of a message, for a Task's one line. */
export function firstSentence(text: string): string {
  return /^.*?(?:[.!?](?=\s|$)|[。！？])/su.exec(text)?.[0] ?? text
}
