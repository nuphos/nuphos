// An "[Image #N]" token marks where an attached image sits in the message
// (composerSerialize.ts). It says nothing about the task.
const IMAGE_REF = /\[Image #\d+\]/g
const LINK = /https?:\/\/\S+/g

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Drop what makes a poor name: image tokens anywhere, and links before the
 * first words. A link after them shrinks to its host, so "check
 * https://github.com/org/repo/pull/12" keeps where it points without spending
 * the length on the path. A message with nothing else becomes the link's host.
 */
function readable(cleaned: string): string {
  const text = cleaned.replace(IMAGE_REF, ' ').replace(/\s+/g, ' ').trim()
  const words = text.replace(/^(?:https?:\/\/\S+\s*)+/, '')

  if (words) return words.replace(LINK, host)

  const link = text.match(LINK)?.[0]

  return link ? host(link) : cleaned
}

/**
 * The title a conversation gets when no model-written one is available —
 * at insert (before the first round finishes) and whenever title generation
 * fails or comes back empty. Both callers must agree, or the same chat's
 * title changes shape depending on which path produced it.
 */
export function fallbackTitle(message: string): string {
  const cleaned = readable(message.trim().replace(/\s+/g, ' '))

  if (cleaned.length <= 50) return cleaned
  const truncated = cleaned.slice(0, 50)
  const lastSpace = truncated.lastIndexOf(' ')

  if (lastSpace > 30) return `${truncated.slice(0, lastSpace)}...`

  return `${truncated}...`
}
