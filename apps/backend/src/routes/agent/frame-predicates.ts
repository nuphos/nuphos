export function isUiErrorFrame(raw: string): boolean {
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      const payload = JSON.parse(line.slice(5).trim()) as { type?: string }

      if (payload.type === 'error') return true
    } catch {
      // not JSON — keep scanning, but a malformed frame is not an error frame
    }
  }

  return false
}

export function isTextDeltaFrame(payload: Record<string, unknown>): boolean {
  if (payload.type !== 'text-delta') return false

  return [payload.delta, payload.text, payload.content, payload.textDelta].some(
    (value) => typeof value === 'string' && value.length > 0,
  )
}

export function isToolFrame(payload: Record<string, unknown>): boolean {
  const type = typeof payload.type === 'string' ? payload.type : ''

  return (
    type.startsWith('tool-') ||
    type === 'tool-call' ||
    type === 'tool-result' ||
    typeof payload.toolCallId === 'string' ||
    typeof payload.toolName === 'string'
  )
}
