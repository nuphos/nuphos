import type { Part, ToolPart } from './parts'

const MAX_LIVE_TOOL_OUTPUT_CHARS = 100_000

function appendLiveToolOutput(current: string, delta: string): string {
  const combined = current + delta

  return combined.length <= MAX_LIVE_TOOL_OUTPUT_CHARS
    ? combined
    : combined.slice(-MAX_LIVE_TOOL_OUTPUT_CHARS)
}

export function applyToolOutputDelta(parts: Part[], event: Record<string, unknown>): Part[] {
  const toolCallId = event.toolCallId as string
  const toolName = typeof event.toolName === 'string' ? event.toolName : 'bash'
  const stream = event.stream === 'stderr' ? 'stderr' : event.stream === 'stdout' ? 'stdout' : null
  const delta = typeof event.delta === 'string' ? event.delta : ''

  if (!toolCallId || !stream || !delta) return parts
  const update = (part: ToolPart): ToolPart => ({
    ...part,
    liveOutput: {
      stdout:
        stream === 'stdout'
          ? appendLiveToolOutput(part.liveOutput?.stdout ?? '', delta)
          : (part.liveOutput?.stdout ?? ''),
      stderr:
        stream === 'stderr'
          ? appendLiveToolOutput(part.liveOutput?.stderr ?? '', delta)
          : (part.liveOutput?.stderr ?? ''),
    },
  })

  if (!parts.some((part) => part.type === 'tool' && part.toolCallId === toolCallId)) {
    return [
      ...parts,
      update({
        type: 'tool',
        toolCallId,
        toolName,
        state: 'input-available',
        startedAt: Date.now(),
      }),
    ]
  }

  return parts.map((part) =>
    part.type === 'tool' && part.toolCallId === toolCallId ? update(part) : part,
  )
}
