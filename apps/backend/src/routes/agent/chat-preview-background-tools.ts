import { updateBackgroundToolResult } from '@/lib/agent/db/transcript-background-tool'
import { setClaudeCodeBackgroundToolHandler } from '@/lib/claude-code-preview/autonomous-session-observer'

export function registerBackgroundToolPersistence(): void {
  setClaudeCodeBackgroundToolHandler(async (context, update) => {
    if (update.status !== 'completed' && update.status !== 'failed') return
    await updateBackgroundToolResult({
      sessionId: context.conversationId,
      userId: context.conversationOwnerUserId,
      teamId: context.teamId,
      toolCallId: update.toolCallId,
      state: update.status === 'failed' ? 'output-error' : 'output-available',
      output: update.rawOutput ?? update.contentText ?? null,
      ...(update.status === 'failed'
        ? {
            errorText:
              update.contentText ??
              (typeof update.rawOutput === 'string'
                ? update.rawOutput
                : 'Background command failed'),
          }
        : {}),
    })
  })
}
