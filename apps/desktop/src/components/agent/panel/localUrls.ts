import type { Part } from './parts.ts'

// Hosts that only mean something on the machine that printed them.
const LOCAL_HOST = /^(localhost|[\w-]+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\])$/i
// A URL inside command output: stops at whitespace, quotes, brackets and the
// backslash of a JSON-escaped newline.
const URL_IN_TEXT = /https?:\/\/[^\s"'`<>()[\]{}\\]+/gi
// Tools that run on the user's own machine, so their localhost is the one the
// built-in browser can reach. The sandbox's Bash is not.
const LOCAL_TOOL = /(^|__)local_(exec|terminal)$/
const MAX_TOOL_URLS = 3

export type LocalUrl = { href: string; label: string }

// A sentence that ends on a URL leaves its full stop on the match.
function withoutTrailingPunctuation(text: string): string {
  let end = text.length

  while (end > 0 && '.,;:!?'.includes(text[end - 1])) end -= 1

  return text.slice(0, end)
}

function withoutScheme(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
}

/** A localhost URL as the chip shows and opens it, or null for any other link. */
export function localUrl(raw: string): LocalUrl | null {
  let url: URL

  try {
    url = new URL(withoutTrailingPunctuation(raw.trim()))
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!LOCAL_HOST.test(url.hostname)) return null
  // A server bound to every interface is reached through loopback.
  if (url.hostname === '0.0.0.0' || url.hostname === '[::]') url.hostname = '127.0.0.1'
  const path = url.pathname === '/' ? '' : url.pathname

  return { href: url.toString(), label: `${url.host}${path}${url.search}` }
}

/** True when the link text is the URL itself, so the chip loses nothing the author wrote. */
export function isBareLocalLink(href: string, text: string): boolean {
  return localUrl(href) !== null && withoutScheme(text) === withoutScheme(href)
}

// Output arrives as text, `{ stdout, stderr }`, or a JSON envelope; the URL
// pattern finds a server address in any of them.
function toolText(output: unknown, live?: { stdout: string; stderr: string }): string {
  if (live) return `${live.stdout}\n${live.stderr}`

  if (output === undefined) return ''

  return typeof output === 'string' ? output : JSON.stringify(output)
}

/** Local servers the turn's own-machine tools printed, minus any whose origin the answer links. */
export function turnLocalUrls(parts: readonly Part[]): LocalUrl[] {
  const mentioned = new Set<string>()
  const found = new Map<string, LocalUrl>()

  for (const part of parts) {
    if (part.type === 'text') {
      for (const match of part.text.matchAll(URL_IN_TEXT)) {
        const url = localUrl(match[0])

        if (url) mentioned.add(new URL(url.href).origin)
      }
    }
    if (part.type !== 'tool' || !LOCAL_TOOL.test(part.toolName)) continue
    if (part.state === 'output-error') continue
    for (const match of toolText(part.output, part.liveOutput).matchAll(URL_IN_TEXT)) {
      const url = localUrl(match[0])

      if (url && !found.has(url.href)) found.set(url.href, url)
    }
  }

  return [...found.values()]
    .filter((url) => !mentioned.has(new URL(url.href).origin))
    .slice(0, MAX_TOOL_URLS)
}
