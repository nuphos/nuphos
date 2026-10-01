export type ToolResultErrorSource = 'step' | 'response'

export type ToolResultError = {
  toolName?: string
  toolCallId?: string
  message: string
  kind?: string
  source?: ToolResultErrorSource
}

export type ToolResultErrorTelemetry = {
  toolName: string
  kind: string
  source: ToolResultErrorSource | 'unknown'
}

function truncateToolResultErrorMessage(text: string, maxLength = 2000): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

export function classifyToolErrorText(message: string): string | undefined {
  if (message.startsWith('Invalid input for tool ')) {
    if (message.includes('JSON parsing failed')) return 'tool_input_json_parse'
    if (message.includes('Type validation failed')) return 'tool_input_validation'

    return 'tool_input_invalid'
  }
  if (message === 'Tool call was interrupted before completion.') return 'tool_interrupted'

  return undefined
}

export function parseToolResultError(output: unknown): { message: string; kind?: string } | null {
  if (!output || typeof output !== 'object') return null
  const record = output as Record<string, unknown>

  if (record.type !== 'error-text') return null
  const value = record.value
  const message =
    typeof value === 'string' ? value : value === undefined ? null : JSON.stringify(value)

  if (!message) return null

  return {
    message: truncateToolResultErrorMessage(message),
    kind: classifyToolErrorText(message),
  }
}

export function dedupeToolResultErrors(errors: ToolResultError[]): ToolResultError[] {
  const out: ToolResultError[] = []
  const seen = new Set<string>()

  for (const err of errors) {
    const key = `${err.toolCallId ?? ''}:${err.toolName ?? ''}:${err.message}`

    if (seen.has(key)) continue
    seen.add(key)
    out.push(err)
  }

  return out
}

export function toolResultErrorsForTelemetry(
  errors: ToolResultError[],
): ToolResultErrorTelemetry[] {
  return errors.map((error) => ({
    toolName: error.toolName ?? 'unknown',
    kind: error.kind ?? 'tool_result_error',
    source: error.source ?? 'unknown',
  }))
}

export function reportableToolResultErrors(errors: ToolResultError[]): ToolResultError[] {
  return errors.filter((error) => error.kind === undefined)
}

export function toolResultErrorFingerprint(errors: ToolResultError[]): string {
  const classes = new Set(
    toolResultErrorsForTelemetry(errors).map((error) => `${error.toolName}:${error.kind}`),
  )

  return `agent_tool_result:${[...classes].sort((left, right) => left.localeCompare(right)).join('|')}`
}

export function isRecoverableOutputTruncation(
  finishReason: string | undefined,
  toolResultErrors: ToolResultError[],
): boolean {
  if (finishReason !== 'length' || toolResultErrors.length === 0) return false

  return toolResultErrors.every(
    (item) =>
      item.kind === 'tool_input_json_parse' ||
      item.kind === 'tool_input_validation' ||
      item.kind === 'tool_input_invalid' ||
      item.kind === 'tool_interrupted',
  )
}

export function toolResultOutputFromSdkResult(result: any): unknown {
  return result?.output ?? result?.result ?? result?.content ?? result?.toolResult?.output
}
