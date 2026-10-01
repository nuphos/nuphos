/**
 * The title a conversation gets when no model-written one is available —
 * at insert (before the first round finishes) and whenever title generation
 * fails or comes back empty. Both callers must agree, or the same chat's
 * title changes shape depending on which path produced it.
 */
export function fallbackTitle(message: string): string {
  const cleaned = message.trim().replace(/\s+/g, ' ')

  if (cleaned.length <= 50) return cleaned
  const truncated = cleaned.slice(0, 50)
  const lastSpace = truncated.lastIndexOf(' ')

  if (lastSpace > 30) return `${truncated.slice(0, lastSpace)}...`

  return `${truncated}...`
}
