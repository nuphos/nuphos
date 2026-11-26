export type BotTemplateLink = { id: string; version: string }

export function parseBotTemplateUrl(raw: string): BotTemplateLink | null {
  try {
    const url = new URL(raw)

    if (url.protocol !== 'nuphos:' || url.hostname !== 'bot-template') return null
    if (url.username || url.password || url.port || url.pathname || url.hash) return null
    const keys = [...url.searchParams.keys()]

    if (keys.length !== 2 || !keys.includes('id') || !keys.includes('version')) return null
    const id = url.searchParams.get('id') ?? ''
    const version = url.searchParams.get('version') ?? ''

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 100) return null
    if (!/^\d+\.\d+\.\d+$/.test(version) || version.length > 50) return null

    return { id, version }
  } catch {
    return null
  }
}
