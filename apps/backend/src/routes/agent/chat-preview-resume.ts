// POST /agent/chat arriving while a Claude Code turn is parked on a human
// decision: the body IS the decision (the desktop stamps approval/tool output
// onto the tool part, or the user simply answered), so resolve the wait and
// hand the new streamId to the run's replica instead of starting a turn.
import {
  listPendingPreviewWaits,
  resolvePreviewDecision,
} from '@/lib/claude-code-preview/decision-waiter'

import type { AgentChatBody, AgentRun } from './types'
import type { PreviewWait } from '@/lib/claude-code-preview/decision-waiter'
import type { UIMessage } from 'ai'

type ToolPartLike = {
  type: string
  toolCallId?: string
  toolName?: string
  state?: string
  output?: unknown
  approval?: { id?: string; approved?: boolean; [key: string]: unknown }
}

function isToolPart(candidate: ToolPartLike): boolean {
  // AI SDK UI messages serialize statically named tools as `tool-<name>` and
  // dynamic tools as `dynamic-tool`. Keep accepting the legacy normalized
  // `tool` shape too, since persisted/older clients may still send it.
  return (
    candidate.type === 'tool' ||
    candidate.type === 'dynamic-tool' ||
    candidate.type.startsWith('tool-')
  )
}

function toolPartFor(messages: UIMessage[], wait: PreviewWait): ToolPartLike | undefined {
  const toolCallId = wait.kind === 'agent-permission' ? wait.ref : wait.waitId

  if (!toolCallId) return undefined
  for (let index = messages.length - 1; index >= 0; index--) {
    const part = (messages[index]?.parts as ToolPartLike[] | undefined)?.find((candidate) => {
      if (!isToolPart(candidate) || candidate.toolCallId !== toolCallId) return false

      return wait.kind !== 'agent-permission' || candidate.approval?.id === `openab:${wait.waitId}`
    })

    if (part) return part
  }

  return undefined
}

function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === 'user')

  return (
    last?.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n') ?? ''
  )
}

function decisionPayload(
  wait: PreviewWait,
  body: AgentChatBody,
  part: ToolPartLike | undefined,
): Record<string, unknown> {
  const approved = part?.approval?.approved
  const decided = approved === undefined ? undefined : approved ? 'approved' : 'rejected'

  return {
    ...(body.resumeReason ? { resumeReason: body.resumeReason } : {}),
    ...(decided ? { decision: decided } : {}),
    ...(part?.output === undefined ? {} : { output: part.output }),
    ...(part ? {} : { userMessage: lastUserText(body.messages) }),
  }
}

/**
 * Resolves the wait this request answers, if any. Prefers the wait whose
 * tool card the body carries a response for; otherwise the newest wait
 * (REST-decided approvals arrive here only as a continuation).
 */
export async function resolvePreviewWaitFromChat(args: {
  userId: string
  sessionId: string
  streamId: string
  body: AgentChatBody
}): Promise<PreviewWait | null> {
  const pending = await listPendingPreviewWaits(args.userId, args.sessionId)

  if (pending.length === 0) return null
  const answered = pending.find((wait) => toolPartFor(args.body.messages, wait))
  const wait = answered ?? pending[pending.length - 1]

  if (!wait) return null
  const resolved = await resolvePreviewDecision({
    userId: args.userId,
    sessionId: args.sessionId,
    waitId: wait.waitId,
    payload: decisionPayload(wait, args.body, toolPartFor(args.body.messages, wait)),
    streamId: args.streamId,
  })

  return resolved ? wait : null
}

/** The continuation run, once the turn's replica has adopted the streamId. */
export async function awaitAdoptedPreviewRun(
  userId: string,
  streamId: string,
  timeoutMs = 5_000,
): Promise<AgentRun | null> {
  // Lazy: the run registry sits in the routes/agent import cycle, which only
  // resolves when entered from the route module.
  const { agentRunKey, agentRuns } = await import('./run-registry')
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const run = agentRuns.get(agentRunKey(userId, streamId))

    if (run) return run
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
