// AI-SDK-adapted MCP tools delegate their card to the runtime's ACP call id.
// This is an ownership contract, not a match between concurrent invocations.
export const TOOL_PRESENTATION = 'ai.nuphos/toolPresentation'
export const TOOL_PRESENTATION_FRAME = 'nuphos-tool-presentation'

export function runtimeToolResult(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const outer = value as Record<string, unknown>
  const result = outer.result && typeof outer.result === 'object' ? outer.result : outer
  const record = result as Record<string, unknown>
  const meta = record._meta as Record<string, unknown> | undefined

  return meta?.[TOOL_PRESENTATION] === 'runtime' ? record : null
}

export function runtimeToolOutput(result: Record<string, unknown>): unknown {
  if ('structuredContent' in result) return result.structuredContent
  const content: unknown[] = Array.isArray(result.content) ? result.content : []
  const text = content
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const part = item as Record<string, unknown>

      return part.type === 'text' && typeof part.text === 'string' ? [part.text] : []
    })
    .join('\n')

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}
