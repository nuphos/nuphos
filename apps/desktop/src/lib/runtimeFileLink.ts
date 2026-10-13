// Agents cite files they touched as plain markdown links — an absolute
// runtime path, or one relative to the workspace, optionally with a `:line`
// suffix. Those paths live on the conversation's runtime, so a click opens
// them in Files instead of resolving against the app's own origin.
export function runtimeFilePathFromHref(href: string): string | null {
  const raw = href
    .trim()
    .split(/[?#]/, 1)[0]
    .replace(/:\d+(:\d+)?$/, '')

  if (!raw || raw.startsWith('//') || raw.startsWith('/teams/')) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(raw)) return null
  try {
    const path = decodeURIComponent(new URL(raw, 'file:///workspace/').pathname)

    return path === '/' || path.includes('\0') ? null : path
  } catch {
    return null
  }
}

export type RuntimeFileContent = { name: string; size: number; data: string }

export function runtimeFilePreview(
  file: RuntimeFileContent,
): { image: string } | { text: string } | null {
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))
  const head = Array.from(bytes.subarray(0, 12))
  let type: string | undefined

  if (head.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10') type = 'image/png'
  else if (head[0] === 255 && head[1] === 216 && head[2] === 255) type = 'image/jpeg'
  else if (/^GIF8[79]a$/.test(String.fromCharCode(...head.slice(0, 6)))) type = 'image/gif'
  else if (
    String.fromCharCode(...head.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...head.slice(8, 12)) === 'WEBP'
  )
    type = 'image/webp'
  if (type) return { image: `data:${type};base64,${file.data}` }
  if (bytes.includes(0)) return null
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return null
  }
}
