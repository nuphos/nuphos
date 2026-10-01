import { config } from '@/config'
import { queueRuntimeHandoff } from '@/lib/claude-code-preview/runtime-handoff'
import { RunHandoff } from '@/lib/lifecycle'

import { persistHandedOffPreviewTurn } from './chat-preview-finish'

import type { AgentRun } from './types'
import type { UIMessage } from 'ai'

export const HANDED_OFF = Symbol('handed-off')
export const HANDED_OFF_TOOL_ERROR =
  'Nuphos restarted before this tool reported back. The agent kept running; its reply continues below.'

/** Settles only when a draining replica lets go of the turn; a user stop still cancels it. */
export function handedOff(signal: AbortSignal): Promise<typeof HANDED_OFF> {
  return new Promise((resolve) => {
    const settle = () => {
      if (signal.reason instanceof RunHandoff) resolve(HANDED_OFF)
    }

    if (signal.aborted) settle()
    else signal.addEventListener('abort', settle, { once: true })
  })
}

type PreviewHandoffArgs = {
  run: AgentRun
  sessionId: string
  teamId: string
  userId: string
  actorUserId: string
  messages: UIMessage[]
  firstMessage: string
  locale: string
  /** Still running on the runtime; this replica stops listening to it. */
  prompt: Promise<unknown>
  /** Tools still running on the runtime are marked as handed off by the caller. */
  orderedParts: UIMessage['parts']
  steered: UIMessage[]
}

/** Save what streamed so far and leave the rest of the turn to the adopting replica. */
export async function handOffPreviewTurn(args: PreviewHandoffArgs): Promise<void> {
  args.prompt.catch(() => {})
  await persistHandedOffPreviewTurn({
    ...args,
    provider: config.agent.modelProvider,
  })
  queueRuntimeHandoff({
    teamId: args.teamId,
    conversationId: args.sessionId,
    ownerUserId: args.userId,
    actorUserId: args.actorUserId,
    locale: args.locale,
  })
}
