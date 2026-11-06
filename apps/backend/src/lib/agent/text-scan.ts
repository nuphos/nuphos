/**
 * Linear replacements for regexes whose backtracking is super-linear on
 * adversarial input. Webhook URLs and other user input reach these paths, so
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
