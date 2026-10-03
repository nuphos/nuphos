export type RuntimeFileReference = {
  teamId: string
  runtimeId: string
  sessionId: string
  path: string
}

export function parseRuntimeFileLink(href: string): RuntimeFileReference | null {
  try {
    const url = new URL(href)

    if (url.origin !== 'https://nuphos.ai' || url.username || url.password) return null
    const match = /^\/teams\/([^/]+)\/agent-runtimes\/([^/]+)\/files\/content$/.exec(url.pathname)
    const sessionId = url.searchParams.get('sessionId')
    const path = url.searchParams.get('path')

    if (!match || !sessionId || !path || path.length > 4096 || path.includes('\0')) return null

    return {
      teamId: decodeURIComponent(match[1]),
      runtimeId: decodeURIComponent(match[2]),
      sessionId,
      path,
    }
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
