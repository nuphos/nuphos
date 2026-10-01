import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type LocalSessionSource = 'claude-code' | 'codex'

export type LocalAgentSessionInfo = {
  id: string
  source: LocalSessionSource
  path: string
  title: string
  subtitle: string
  updatedAt: string
}

export function validateLocalSessionSource(source: string): LocalSessionSource {
  if (source === 'claude-code' || source === 'codex') return source
  throw new Error(`Invalid local session source: ${source}`)
}

function localSessionRoots(source: LocalSessionSource): string[] {
  return source === 'claude-code'
    ? [path.join(os.homedir(), '.claude', 'projects')]
    : [
        path.join(os.homedir(), '.codex', 'sessions'),
        path.join(os.homedir(), '.codex', 'archived_sessions'),
      ]
}

async function listJsonlFiles(
  root: string,
  maxDepth: number,
): Promise<{ path: string; mtimeMs: number }[]> {
  if (!fsSync.existsSync(root)) return []
  const out: { path: string; mtimeMs: number }[] = []

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return
    let entries: fsSync.Dirent[]

    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1)

          return
        }
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return
        try {
          const stat = await fs.stat(fullPath)

          out.push({ path: fullPath, mtimeMs: stat.mtimeMs })
        } catch {
          // Ignore sessions that disappear while the menu is opening.
        }
      }),
    )
  }

  await walk(root, 0)

  return out
}

export function textFromMessageContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const text = content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const value = 'text' in part ? part.text : 'input_text' in part ? part.input_text : ''

      return typeof value === 'string' ? value : ''
    })
    .filter(Boolean)
    .join(' ')

  return text || null
}

export function isConversationPrompt(value: string | null): value is string {
  const cleaned = value?.replace(/\s+/g, ' ').trim()

  if (!cleaned) return false
  if (cleaned.startsWith('# AGENTS.md instructions')) return false
  if (cleaned.startsWith('<environment_context>')) return false
  if (cleaned.includes('========= MEMORY_SUMMARY BEGINS =========')) return false

  return true
}

export function cleanSessionTitle(value: string | null, fallback: string): string {
  const cleaned = value?.replace(/\s+/g, ' ').trim()

  if (!cleaned) return fallback

  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned
}

function compactSessionPath(value: string): string {
  const home = os.homedir()

  return value.startsWith(home) ? `~${value.slice(home.length)}` : value
}

async function readSessionPreview(
  filePath: string,
): Promise<{ title: string | null; subtitle: string | null }> {
  let handle: fs.FileHandle | null = null

  try {
    handle = await fs.open(filePath, 'r')
    const buffer = Buffer.alloc(512 * 1024)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    let aiTitle: string | null = null
    let firstUser: string | null = null
    let cwd: string | null = null

    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let record: unknown

      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (!record || typeof record !== 'object') continue
      const item = record as Record<string, unknown>

      if (typeof item.cwd === 'string') cwd ??= compactSessionPath(item.cwd)
      if (item.type === 'session_meta') {
        const payload =
          item.payload && typeof item.payload === 'object'
            ? (item.payload as Record<string, unknown>)
            : null

        if (typeof payload?.cwd === 'string') cwd ??= compactSessionPath(payload.cwd)
      }
      if (item.type === 'ai-title' && typeof item.aiTitle === 'string') {
        aiTitle = item.aiTitle
        break
      }
      if (item.type === 'user' && !firstUser) {
        const message =
          item.message && typeof item.message === 'object'
            ? (item.message as Record<string, unknown>)
            : null
        const candidate = textFromMessageContent(message?.content)

        if (isConversationPrompt(candidate)) firstUser = candidate
      }
      if (item.type === 'response_item' && !firstUser) {
        const payload =
          item.payload && typeof item.payload === 'object'
            ? (item.payload as Record<string, unknown>)
            : null

        if (payload?.type === 'message' && payload.role === 'user') {
          const candidate = textFromMessageContent(payload.content)

          if (isConversationPrompt(candidate)) firstUser = candidate
        }
      }
      if (item.type === 'event_msg' && !firstUser) {
        const payload =
          item.payload && typeof item.payload === 'object'
            ? (item.payload as Record<string, unknown>)
            : null

        if (payload?.type === 'user_message' && typeof payload.message === 'string') {
          if (isConversationPrompt(payload.message)) firstUser = payload.message
        }
      }
    }

    return { title: aiTitle ?? firstUser, subtitle: cwd }
  } finally {
    await handle?.close()
  }
}

export async function listLocalAgentSessions(
  source: LocalSessionSource,
): Promise<LocalAgentSessionInfo[]> {
  const files = (
    await Promise.all(
      localSessionRoots(source).map((root) => listJsonlFiles(root, source === 'codex' ? 5 : 2)),
    )
  )
    .flat()
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 8)

  const sessions = await Promise.allSettled(
    files.map(async (file) => {
      const preview = await readSessionPreview(file.path)
      const fallback = path.basename(file.path, '.jsonl').replace(/^rollout-/, '')

      return {
        id: file.path,
        source,
        path: file.path,
        title: cleanSessionTitle(preview.title, fallback),
        subtitle: preview.subtitle ?? compactSessionPath(path.dirname(file.path)),
        updatedAt: new Date(file.mtimeMs).toISOString(),
      }
    }),
  )

  return sessions
    .filter(
      (result): result is PromiseFulfilledResult<LocalAgentSessionInfo> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value)
}
