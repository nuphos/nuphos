/** Terminal tool results the runtime reported, by tool call. */
export function runtimeToolResults(stored: unknown[]): Map<string, Record<string, unknown>> {
  const results = new Map<string, Record<string, unknown>>()

  for (const part of stored) {
    if (!part || typeof part !== 'object') continue
    const value = part as Record<string, unknown>

    if (value.runtimeResult === true && typeof value.toolCallId === 'string') {
      results.set(value.toolCallId, value)
    }
  }

  return results
}

/** UI snapshots cannot roll back a terminal result reported by the runtime. */
export function preserveRuntimeToolResults(
  incoming: unknown[],
  results: ReadonlyMap<string, Record<string, unknown>>,
): unknown[] {
  return incoming.map((part) => {
    if (!part || typeof part !== 'object') return part
    const value = part as Record<string, unknown>
    const result = typeof value.toolCallId === 'string' ? results.get(value.toolCallId) : undefined

    if (!result) return part

    return {
      ...value,
      state: result.state,
      errorText: result.errorText,
      completedAt: result.completedAt,
      runtimeResult: true,
    }
  })
}
