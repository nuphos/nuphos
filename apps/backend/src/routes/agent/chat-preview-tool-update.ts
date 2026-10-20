import type { createPreviewToolLog } from './chat-preview-run'
import type { PreviewAgentUpdate } from '@/lib/claude-code-preview/preview-agent-update'

import { isToolSearchTitle, nuphosToolName } from '@/lib/claude-code-preview/preview-agent-update'
import { INTERRUPTED_TOOL_ERROR } from '@/lib/claude-code-preview/preview-transcript'

export function handlePreviewToolUpdate(
  emit: (frame: Record<string, unknown>) => void,
  log: ReturnType<typeof createPreviewToolLog>,
  update: Extract<PreviewAgentUpdate, { kind: 'tool' }>,
): void {
  const known = log.states.get(update.toolCallId)
  const name = update.title === '' ? (known?.name ?? 'tool') : update.title
  const classic = nuphosToolName(update.mcpToolId) ?? known?.toolName
  const hidden = update.revealed
    ? false
    : (known?.hidden ?? (isToolSearchTitle(name) || classic !== undefined))
  const input = update.rawInput ?? known?.input ?? {}
  const revealing = known?.hidden === true && !hidden

  if (!known || revealing || update.rawInput !== undefined || name !== known.name) {
    log.states.set(update.toolCallId, { name, toolName: classic ?? name, input, hidden })
    if (!isToolSearchTitle(name)) log.record(update.toolCallId, classic ?? name, input)
    if (!hidden) {
      emit({ type: 'tool-input-available', toolCallId: update.toolCallId, toolName: name, input })
    }
  }
  if (update.status === 'completed') {
    const output = update.rawOutput ?? update.contentText ?? null

    log.complete(update.toolCallId, output)
    if (!hidden) emit({ type: 'tool-output-available', toolCallId: update.toolCallId, output })
  } else if (update.status === 'failed') {
    const errorText =
      update.contentText ??
      (typeof update.rawOutput === 'string' ? update.rawOutput : `${name} failed`)

    const cause = log.fail(update.toolCallId, errorText)

    if (!hidden)
      emit({ type: 'tool-output-error', toolCallId: update.toolCallId, errorText: cause })
  }
}

/** Calls still waiting on a result: the ones a steer arriving now could cut off. */
export function openToolCalls(log: ReturnType<typeof createPreviewToolLog>): string[] {
  return log
    .list()
    .filter((step) => step.output === undefined && step.errorText === undefined)
    .map((step) => step.toolCallId)
}

/**
 * A steer aborts the running cycle. A call it cut off while the model was
 * still writing its input never runs, so no result ever arrives and its timer
 * would tick until the turn ends. Once the agent answers the steer, close the
 * calls that were open at the steer and never got their input. A call with
 * input may be a background command that is still running, so it stays open.
 */
export function closeCallsCutOffBySteer(
  emit: (frame: Record<string, unknown>) => void,
  log: ReturnType<typeof createPreviewToolLog>,
  cutOff: readonly string[],
): void {
  const open = new Set(openToolCalls(log))

  for (const toolCallId of cutOff) {
    const state = log.states.get(toolCallId)

    if (!open.has(toolCallId) || !isEmptyInput(state?.input)) continue
    const errorText = log.fail(toolCallId, INTERRUPTED_TOOL_ERROR)

    if (!state?.hidden) emit({ type: 'tool-output-error', toolCallId, errorText })
  }
}

function isEmptyInput(input: unknown): boolean {
  return (
    input == null ||
    (typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0)
  )
}
