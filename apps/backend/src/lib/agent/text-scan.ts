/**
 * Linear replacements for regexes whose backtracking is super-linear on
 * adversarial input. Model output and webhook URLs both reach these paths, so
 * the pattern has to stay O(n) — each function reproduces the exact match set
 * of the regex it replaced.
 */

/** Replaces `.replace(/\/+$/, '')`. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length

  while (end > 0 && value[end - 1] === '/') end--

  return value.slice(0, end)
}

/** Replaces `.replace(/^_+|_+$/g, '')`. */
export function trimUnderscores(value: string): string {
  let start = 0
  let end = value.length

  while (start < end && value[start] === '_') start++
  while (end > start && value[end - 1] === '_') end--

  return value.slice(start, end)
}

/**
 * Replaces `text.match(/\{[\s\S]*\}/)?.[0]`: the first `{` through the last
 * `}` after it. Returns null when there is no such span.
 */
export function extractBracedObject(text: string): string | null {
  const start = text.indexOf('{')

  if (start === -1) return null
  const end = text.lastIndexOf('}')

  if (end < start) return null

  return text.slice(start, end + 1)
}

/**
 * Replaces ``text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]``: the body of
 * the first fenced block, with an optional `json` tag and the whitespace after
 * the opening fence consumed.
 */
export function extractFencedBlock(text: string): string | null {
  const open = text.indexOf('```')

  if (open === -1) return null
  let cursor = open + 3

  if (text.slice(cursor, cursor + 4).toLowerCase() === 'json') cursor += 4
  while (cursor < text.length && WHITESPACE.test(text[cursor]!)) cursor++
  const close = text.indexOf('```', cursor)

  if (close === -1) return null

  return text.slice(cursor, close)
}

const WHITESPACE = /\s/
