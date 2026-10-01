import path from 'node:path'

export type AgentChatDeepLinkPayload = {
  prompt: string
  files: string[]
  cwd?: string
  source?: string
  teamId?: string
  autoSend: boolean
}

const PROTOCOL = 'nuphos:'
const HOST = 'agent-chat'

function isTruthyParam(value: string | null): boolean {
  if (value === null) return false

  return value === '' || value === '1' || value.toLowerCase() === 'true'
}

function isFalseyParam(value: string | null): boolean {
  if (value === null) return false

  return value === '0' || value.toLowerCase() === 'false'
}

function normalizeFilePath(filePath: string, cwd?: string): string {
  if (!cwd || path.isAbsolute(filePath) || !path.isAbsolute(cwd)) return filePath

  return path.resolve(cwd, filePath)
}

export function isAgentChatUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)

    return url.protocol === PROTOCOL && url.hostname === HOST
  } catch {
    return false
  }
}

export function parseAgentChatUrl(rawUrl: string): AgentChatDeepLinkPayload | null {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== PROTOCOL || url.hostname !== HOST) return null

  const prompt = url.searchParams.get('prompt')?.trim() ?? ''
  const cwd = url.searchParams.get('cwd')?.trim() || undefined
  const files = Array.from(
    new Set(
      [...url.searchParams.getAll('file'), ...url.searchParams.getAll('files')]
        .map((file) => file.trim())
        .filter(Boolean)
        .map((file) => normalizeFilePath(file, cwd)),
    ),
  )
  const source = url.searchParams.get('source')?.trim() || undefined
  const teamId =
    (url.searchParams.get('teamId') ?? url.searchParams.get('team_id'))?.trim() || undefined
  const draft = isTruthyParam(url.searchParams.get('draft'))
  const autoSendParam = url.searchParams.get('autoSend') ?? url.searchParams.get('auto_send')
  const autoSend = draft ? false : !isFalseyParam(autoSendParam)

  if (!prompt && files.length === 0) return null

  return { prompt, files, cwd, source, teamId, autoSend }
}
