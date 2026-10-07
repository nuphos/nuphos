// Translates a runtime-owned ACP turn into SSE and transcript updates.
import { randomUUID } from 'node:crypto'

import './chat-preview-autonomous-runs'
import { config } from '@/config'
import { recordLocalRuntimeTurn } from '@/lib/agent/devices/local-runtime/activity'
import { consumePreviewMemoryActivity } from '@/lib/agent/memory-slots/preview-activity'
import { runClaudeCodePreviewPrompt } from '@/lib/claude-code-preview/agent-chat-runtime'
import { withoutEmptyTurnSentinel } from '@/lib/claude-code-preview/codex-turn-failure'
import { previewSessionAccess } from '@/lib/claude-code-preview/credentials-mcp'
import { handleOpenAbPermissionRequest } from '@/lib/claude-code-preview/openab-permission-bridge'
import {
  createPreviewAssistantPartAccumulator,
  interruptToolSteps,
} from '@/lib/claude-code-preview/preview-transcript'
import { watchPreviewTurnPauses } from '@/lib/claude-code-preview/preview-turn-pause'

import { createSteeringAttribution } from '@/lib/claude-code-preview/steering-receipt'
import {
  finishPreviewTurn,
  persistHandedOffPreviewTurn,
  persistInterruptedPreviewTurn,
} from './chat-preview-finish'
import {
  CONNECTION_LOST_TOOL_ERROR,
  HANDED_OFF,
  HANDED_OFF_TOOL_ERROR,
  handOffPreviewTurn,
  handedOff,
  lostToReattach,
} from './chat-preview-handoff'
import { carriedUserMessages, preparePreviewTurn } from './chat-preview-prepare'
import { createPreviewRunState, createPreviewToolLog } from './chat-preview-run'
import { handlePreviewToolUpdate } from './chat-preview-tool-update'
import { appendAgentRunError, appendAgentRunPhase } from './run-frames'

import type { AgentChatBody, AgentRun } from './types'
import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers-shared'
import type { PreviewDecision } from '@/lib/claude-code-preview/decision-waiter'
import type { OpenAbPermissionHandler } from '@/lib/claude-code-preview/openab-acp-session'
import type { TeamRuntimeEndpoint } from '@/lib/claude-code-preview/team-openab-runtime'
import type { UIMessage } from 'ai'

import { RunHandoff } from '@/lib/lifecycle'

export type PreviewChatTurnArgs = {
  run: AgentRun
  sessionId: string
  teamId: string
  userId: string
  actorUserId?: string
  origin: AgentSessionOrigin
  messages: UIMessage[]
  firstMessage: string
  locale: string
  endpoint: TeamRuntimeEndpoint
  kubeContext?: string
  /** The client driving this turn can run port forwards and other client-side local tools. */
  localToolsEnabled?: boolean
  /** Set when the client is resuming a turn rather than sending a new message. */
  resume?: { reason?: NonNullable<AgentChatBody['resumeReason']> }
  diagramId?: string
  currentUrl?: string | null
  slackThread?: { teamId: string; channelId: string; threadTs: string }
  onRunHandoff?: (next: AgentRun) => void
}

export async function runClaudeCodePreviewChatTurn(args: PreviewChatTurnArgs): Promise<void> {
  const { run, sessionId, teamId, userId } = args
  const actorUserId = args.actorUserId ?? userId
  const requestId = run.trace?.requestId ?? randomUUID()
  const startedAt = Date.now()
  const acc = { text: '', reasoning: '' }
  const steeringAttribution = createSteeringAttribution(actorUserId)
  const orderedParts = createPreviewAssistantPartAccumulator(steeringAttribution)
  const answers: string[] = []
  const toolLog = createPreviewToolLog()
  const state = createPreviewRunState({ run, userId, sessionId })
  const pauses = new AbortController()
  // Mid-turn assistant/user segments persisted before the final assistant.
  const steered: UIMessage[] = []
  const segmentStepStart = 0

  appendAgentRunPhase(run, 'connecting-model')
  const prepared = await preparePreviewTurn(args, requestId)
  const clearActiveTurn = () => prepared.clearActiveTurn()

  state.consumeFrames((frame) =>
    consumePreviewMemoryActivity(prepared.memory?.turnMemory.accumulator ?? null, frame),
  )
  const access = previewSessionAccess(sessionId, teamId, actorUserId, userId, {
    external: args.endpoint.external,
    backendUrl: args.endpoint.backendUrl,
  })

  if (args.endpoint.local)
    void recordLocalRuntimeTurn({
      ownerUserId: args.endpoint.local.userId,
      deviceId: args.endpoint.local.deviceId,
      teamId,
      sessionId,
      actorUserId,
    })
  steered.push(...carriedUserMessages(prepared.carried))
  appendAgentRunPhase(run, 'thinking')
  const adopt = (decision: PreviewDecision) => {
    if (state.onResume(decision)) args.onRunHandoff?.(state.current())
  }

  void watchPreviewTurnPauses({
    userId,
    sessionId,
    signal: pauses.signal,
    onPause: (wait) => {
      state.onPause(wait)
    },
    onResume: (_wait, decision) => {
      adopt(decision)
    },
  })

  const permissionRequest: OpenAbPermissionHandler = (request) => {
    return handleOpenAbPermissionRequest({
      userId: actorUserId,
      conversationOwnerUserId: userId,
      conversationId: sessionId,
      request,
      emit: state.emit,
      handleTool: (update) => {
        handlePreviewToolUpdate(state.emit, toolLog, update)
        if (toolLog.list().some((step) => step.toolCallId === update.toolCallId)) {
          orderedParts.appendTool(update.toolCallId)
        }
      },
      signal: state.signal,
      onDecision: adopt,
    })
  }

  const promptOnce = (message: string, freshSessionMessage?: (uncertain?: boolean) => string) =>
    runClaudeCodePreviewPrompt({
      teamId,
      conversationId: sessionId,
      userId: actorUserId,
      conversationOwnerUserId: userId,
      locale: args.locale,
      message,
      attachments: prepared.attachments,
      ...(freshSessionMessage ? { freshSessionMessage } : {}),
      endpoint: args.endpoint,
      mcpServers: access.mcpServers,
      runtime: {
        provider: args.endpoint.provider ?? 'claude-code',
        env: access.runtimeEnv,
      },
      ...(prepared.systemPrompt ? { systemPrompt: prepared.systemPrompt } : {}),
      signal: state.signal,
      onTextDelta: (delta) => {
        acc.text += delta
        orderedParts.appendText(delta)
        state.emit({ type: 'text-delta', delta })
      },
      onAgentUpdate: (update) => {
        if (update.kind === 'runtime-state') {
          state.emit({ type: 'runtime-state', snapshot: update.snapshot })

          return
        }
        if (update.kind === 'steering') {
          const metadata = steeringAttribution()
          const receipt = { id: update.id, text: update.text, ...(metadata ? { metadata } : {}) }

          orderedParts.appendSteering(receipt)
          state.emit({ type: 'data-steering', data: receipt })

          return
        }
        if (update.kind === 'thought') {
          acc.reasoning += update.text
          orderedParts.appendReasoning(update.text)
          state.emit({ type: 'reasoning-delta', delta: update.text })

          return
        }
        handlePreviewToolUpdate(state.emit, toolLog, update)
        if (toolLog.list().some((step) => step.toolCallId === update.toolCallId)) {
          orderedParts.appendTool(update.toolCallId)
        }
      },
      onPermissionRequest: permissionRequest,
    })

  const persistInterrupted = (error: unknown) =>
    persistInterruptedPreviewTurn({
      ...args,
      run: state.current(),
      text: acc.text,
      reasoning: acc.reasoning,
      orderedParts: withoutEmptyTurnSentinel(
        orderedParts.materialize(interruptToolSteps(toolLog.list())),
      ),
      toolSteps: toolLog.list(),
      finalStepStart: segmentStepStart,
      steered,
      error,
      emit: state.emit,
      provider: config.agent.modelProvider,
    })

  const prompt = promptOnce(prepared.message, prepared.freshSessionMessage)

  try {
    if ((await Promise.race([prompt, handedOff(state.signal)])) === HANDED_OFF) {
      pauses.abort()
      state.unbind()
      await handOffPreviewTurn({
        ...args,
        actorUserId,
        prompt,
        run: state.current(),
        orderedParts: orderedParts.materialize(
          interruptToolSteps(toolLog.list(), HANDED_OFF_TOOL_ERROR),
        ),
        steered,
      })
      await clearActiveTurn()

      return
    }
  } catch (err) {
    pauses.abort()
    if (lostToReattach(err, state.signal)) {
      await persistHandedOffPreviewTurn({
        ...args,
        run: state.current(),
        provider: config.agent.modelProvider,
        orderedParts: orderedParts.materialize(
          interruptToolSteps(toolLog.list(), CONNECTION_LOST_TOOL_ERROR),
        ),
        steered,
      })
      await clearActiveTurn()
      state.finish()

      return
    }
    await persistInterrupted(err)

    state.unbind()
    await clearActiveTurn()
    // After a handoff the original run is already closed; the continuation
    // run must carry the error itself instead of the caller's catch.
    if (!state.handedOff()) throw err
    appendAgentRunError(state.current(), err)
    state.finish()

    return
  }
  if (state.signal.aborted && !(state.signal.reason instanceof RunHandoff)) {
    pauses.abort()
    try {
      await persistInterrupted(state.signal.reason)
    } finally {
      await clearActiveTurn()
    }
    state.finish()

    return
  }
  pauses.abort()
  // Runtime completion is authoritative; partial/late tool cards cannot cause
  // backend cancellation or another prompt after completion.
  if (acc.text) answers.push(acc.text)
  await prepared.openPromptSuggestion()

  try {
    await finishPreviewTurn({
      ...args,
      requestId,
      startedAt,
      text: acc.text,
      answer: answers.join('\n\n'),
      reasoning: acc.reasoning,
      orderedParts: orderedParts.materialize(toolLog.list()),
      toolSteps: toolLog.list(),
      finalStepStart: segmentStepStart,
      steered,
      memory: prepared.memory,
      emit: state.emit,
      onRuntimeComplete: state.finish,
      provider: config.agent.modelProvider,
    })
  } finally {
    await clearActiveTurn()
  }
  state.finish()
}
