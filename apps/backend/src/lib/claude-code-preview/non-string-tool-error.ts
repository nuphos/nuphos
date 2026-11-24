import { logEvent } from '@/lib/observability'

/**
 * Where a tool error event came from: the agent runtime's own update, a backend tool handler on
 * this replica, or a tool handler's frame relayed from another replica.
 */
export type ToolErrorSource = 'runtime' | 'tool-handler' | 'relayed'

/**
 * Logs a tool error event whose `errorText` is not a string, which clients expect (#4887). The
 * record names the tool, the value's type and the source, never the value itself (#4920).
 */
export function logNonStringToolError(
  frame: Record<string, unknown>,
  source: ToolErrorSource,
  toolName?: string,
): void {
  if (frame.type !== 'tool-output-error' || typeof frame.errorText === 'string') return
  const value = frame.errorText

  logEvent('warn', 'agent.tool_error.non_string_error_text', {
    source,
    tool_name: toolName ?? (typeof frame.toolName === 'string' ? frame.toolName : 'unknown'),
    error_text_type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
  })
}
