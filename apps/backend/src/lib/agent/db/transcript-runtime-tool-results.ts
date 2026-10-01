/** UI snapshots cannot roll back a terminal result reported by the runtime. */
export function preserveRuntimeToolResults(incoming: unknown[], stored: unknown[]): unknown[] {
  const results = new Map<string, Record<string, unknown>>()

  for (const part of stored) {
    if (!part || typeof part !== 'object') continue
    const value = part as Record<string, unknown>

    if (value.runtimeResult === true && typeof value.toolCallId === 'string') {
      results.set(value.toolCallId, value)
    }
  }

  return incoming.map((part) => {
    if (!part || typeof part !== 'object') return part
    const value = part as Record<string, unknown>
    const result = typeof value.toolCallId === 'string' ? results.get(value.toolCallId) : undefined

    if (!result) return part

    return {
      ...value,
      state: result.state,
      output: result.output,
      errorText: result.errorText,
      completedAt: result.completedAt,
      runtimeResult: true,
    }
  })
}
