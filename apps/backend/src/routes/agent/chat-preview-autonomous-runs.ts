// Runs for turns the runtime starts on its own (wakeups, background tasks, or
// a turn adopted from a replica that shut down) and their durable transcript.
import { randomUUID } from 'node:crypto'

import {
  setClaudeCodeAutonomousPermissionHandler,
  setClaudeCodeAutonomousUpdateHandler,
} from '@/lib/claude-code-preview/agent-chat-runtime'

import { createClaudeCodeAutonomousUpdateHandler } from './chat-preview-autonomous'
import { registerBackgroundToolPersistence } from './chat-preview-background-tools'
import { createPreviewRunState, createPreviewToolLog } from './chat-preview-run'
import { consumePreviewToolPresentation, handlePreviewToolUpdate } from './chat-preview-tool-update'
import { createAgentRun, registerAgentRun } from './run-registry'

import type { ClaudeCodeAutonomousContext } from '@/lib/claude-code-preview/agent-chat-runtime'

export const autonomous = createClaudeCodeAutonomousUpdateHandler({
  begin: (context: ClaudeCodeAutonomousContext, messageId: string) => {
    const streamId = randomUUID()
    const run = createAgentRun(context.conversationOwnerUserId, context.conversationId, streamId, {
      requestId: randomUUID(),
      userId: context.userId,
      sessionId: context.conversationId,
      teamId: context.teamId,
      streamId,
      route: 'claude-code/autonomous',
      method: 'RUNTIME',
    })

    registerAgentRun(run)
    const state = createPreviewRunState({
      run,
      userId: context.conversationOwnerUserId,
      sessionId: context.conversationId,
    })
    const tools = createPreviewToolLog()

    state.consumeFrames((frame) => consumePreviewToolPresentation(state.emit, tools, frame))

    state.emit({ type: 'atlas-autonomous-turn-start', messageId })
    state.emit({ type: 'phase', phase: 'thinking' })

    return {
      emit: state.emit,
      finish: state.finish,
      handleTool: (toolUpdate) => {
        handlePreviewToolUpdate(state.emit, tools, toolUpdate)
      },
      toolSteps: tools.list,
    }
  },
})

registerBackgroundToolPersistence()

setClaudeCodeAutonomousUpdateHandler(autonomous.update)
setClaudeCodeAutonomousPermissionHandler(autonomous.permission)
