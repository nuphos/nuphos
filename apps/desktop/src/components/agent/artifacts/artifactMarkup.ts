// Small readers and writers for artifact markup and CSS, shared by the
// inliner. No DOM: they run in the renderer and under node --test alike.
import type { FetchedAsset } from './artifactExport.ts'

export const REMOTE = /^(?:https?:)?\/\//i

export type Attributes = { name: string; value: string | null }[]

const SPACE = /\s/

/** A tag's attributes, read one at a time: names, optional `=`, quoted or bare values. */
export function parseAttributes(source: string): Attributes {
  const attributes: Attributes = []
  let i = 0

  const skipSpace = () => {
    while (i < source.length && SPACE.test(source[i] ?? '')) i++
  }

  while (i < source.length) {
    skipSpace()
    const start = i

    while (i < source.length && !SPACE.test(source[i] ?? '') && !'=/>'.includes(source[i] ?? ''))
      i++
    const name = source.slice(start, i).toLowerCase()

    if (!name) {
      i++
      continue
    }
    skipSpace()
    if (source[i] !== '=') {
      attributes.push({ name, value: null })
      continue
    }
    i++
    skipSpace()
    const quote = source[i]
    let value: string

    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, i + 1)
      const close = end === -1 ? source.length : end

      value = source.slice(i + 1, close)
      i = close + 1
    } else {
      const valueStart = i

      while (i < source.length && !SPACE.test(source[i] ?? '') && source[i] !== '>') i++
      value = source.slice(valueStart, i)
    }
    attributes.push({ name, value: decodeEntities(value) })
  }

  return attributes
}

export function attribute(attributes: Attributes, name: string): string | null {
  return attributes.find((entry) => entry.name === name)?.value ?? null
}

export function renderAttributes(attributes: Attributes, drop: readonly string[] = []): string {
  return attributes
    .filter((entry) => !drop.includes(entry.name))
    .map((entry) =>
      entry.value === null ? ` ${entry.name}` : ` ${entry.name}="${escapeAttribute(entry.value)}"`,
    )
    .join('')
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

export function absolute(ref: string, base?: string): string | null {
  const trimmed = ref.trim()

  if (!base && !REMOTE.test(trimmed)) return null
  try {
    const url = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed, base)

    return /^https?:$/.test(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

export function base64(bytes: Uint8Array): string {
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(binary)
}

export function mimeOf(asset: FetchedAsset, url: string): string {
  const declared = asset.contentType.split(';')[0]?.trim().toLowerCase()

  if (declared && declared !== 'application/octet-stream') return declared
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? ''

  return EXTENSION_TYPES[extension] ?? 'application/octet-stream'
}

const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  css: 'text/css',
  js: 'text/javascript',
}

export async function replaceAsync(
  input: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => Promise<string>,
): Promise<string> {
  const matches = [...input.matchAll(pattern)] as RegExpExecArray[]
  const replacements = await Promise.all(matches.map(replace))
  let output = ''
  let last = 0

  matches.forEach((match, index) => {
    output += input.slice(last, match.index) + replacements[index]
    last = match.index + match[0].length
  })

  return output + input.slice(last)
}

/** `url("x")`, `'x'` or `x` with any quotes and spaces taken off. */
export function unquote(value: string): string {
  const trimmed = value.trim()
  const first = trimmed[0]

  return (first === '"' || first === "'") && trimmed.endsWith(first)
    ? trimmed.slice(1, -1)
    : trimmed
}

/** An @import's target and media list: `url(x) screen` or `"x" screen`. */
export function parseImport(rule: string): { ref: string; media: string } {
  const body = rule.trim()

  if (body.toLowerCase().startsWith('url(')) {
    const close = body.indexOf(')')

    return { ref: unquote(body.slice(4, close)), media: body.slice(close + 1).trim() }
  }
  const quote = body[0]
  const end = quote === '"' || quote === "'" ? body.indexOf(quote, 1) : body.search(/\s|$/)

  return quote === '"' || quote === "'"
    ? { ref: body.slice(1, end), media: body.slice(end + 1).trim() }
    : { ref: body.slice(0, end), media: body.slice(end).trim() }
}
