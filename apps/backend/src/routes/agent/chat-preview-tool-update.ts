import type { createPreviewToolLog } from './chat-preview-run'
import type { PreviewAgentUpdate } from '@/lib/claude-code-preview/preview-agent-update'

import { isToolSearchTitle, nuphosToolName } from '@/lib/claude-code-preview/preview-agent-update'

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
