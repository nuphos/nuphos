// What a `render_artifact` call carries, and the version lines a chat's calls
// form. The backend tool echoes only a receipt, so the call's input is the
// artifact.

export const ARTIFACT_TOOL = 'render_artifact'

export type ArtifactKind = 'html' | 'markdown' | 'svg' | 'code'

export type ArtifactPayload = {
  artifactId: string
  title: string
  kind: ArtifactKind
  language?: string
  content: string
}

/** One call: the payload plus where it sits in its artifact's version line. */
export type ArtifactVersion = ArtifactPayload & {
  toolCallId: string
  /** 1-based, in the order the chat holds the calls. */
  version: number
  createdAt?: number
}

const KINDS = new Set<ArtifactKind>(['html', 'markdown', 'svg', 'code'])
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export function parseArtifactPayload(value: unknown): ArtifactPayload | null {
  if (!value || typeof value !== 'object') return null
  const { artifactId, title, kind, language, content } = value as Record<string, unknown>

  if (typeof artifactId !== 'string' || !ID.test(artifactId)) return null
  if (typeof title !== 'string' || !title.trim()) return null
  if (typeof kind !== 'string' || !KINDS.has(kind as ArtifactKind)) return null
  if (typeof content !== 'string' || !content) return null

  return {
    artifactId,
    title: title.trim(),
    kind: kind as ArtifactKind,
    ...(kind === 'code' && typeof language === 'string' && language.trim()
      ? { language: language.trim().toLowerCase() }
      : {}),
    content,
  }
}

type PartLike = {
  type: string
  toolCallId?: string
  toolName?: string
  state?: string
  input?: unknown
  startedAt?: number
  completedAt?: number
}

/**
 * Every artifact the messages hold, oldest version first. A call that failed
 * never showed anything, so it takes no version number.
 */
export function collectArtifacts(
  messages: readonly { parts: readonly PartLike[] }[],
): Map<string, ArtifactVersion[]> {
  const lines = new Map<string, ArtifactVersion[]>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool' || part.toolName !== ARTIFACT_TOOL || !part.toolCallId) continue
      if (part.state === 'output-error') continue
      const payload = parseArtifactPayload(part.input)

      if (!payload) continue
      const line = lines.get(payload.artifactId) ?? []
      const createdAt = part.completedAt ?? part.startedAt

      line.push({
        ...payload,
        toolCallId: part.toolCallId,
        version: line.length + 1,
        ...(createdAt === undefined ? {} : { createdAt }),
      })
      lines.set(payload.artifactId, line)
    }
  }

  return lines
}

const CODE_EXTENSIONS: Partial<Record<string, string>> = {
  bash: 'sh',
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  markdown: 'md',
  python: 'py',
  py: 'py',
  ruby: 'rb',
  rust: 'rs',
  shell: 'sh',
  sh: 'sh',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  yaml: 'yaml',
  yml: 'yaml',
  golang: 'go',
  go: 'go',
  terraform: 'tf',
  hcl: 'tf',
  dockerfile: 'Dockerfile',
}

/** What the card and the panel call this kind of artifact. */
export function artifactKindLabel(payload: Pick<ArtifactPayload, 'kind' | 'language'>): string {
  if (payload.kind === 'html') return 'Page'
  if (payload.kind === 'markdown') return 'Document'
  if (payload.kind === 'svg') return 'Image'
  if (!payload.language) return 'Code'

  return payload.language.length <= 3
    ? payload.language.toUpperCase()
    : payload.language.charAt(0).toUpperCase() + payload.language.slice(1)
}

/** The fence language that shows this artifact's source. */
export function artifactSourceLanguage(payload: Pick<ArtifactPayload, 'kind' | 'language'>) {
  if (payload.kind === 'html') return 'html'
  if (payload.kind === 'svg') return 'xml'
  if (payload.kind === 'markdown') return 'markdown'

  return payload.language ?? 'text'
}

/** A file name for Download: the title as a slug, with the kind's extension. */
export function artifactFileName(payload: Pick<ArtifactPayload, 'title' | 'kind' | 'language'>) {
  const slug =
    payload.title
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .toLowerCase()
      .slice(0, 80) || 'artifact'

  if (payload.kind === 'html') return `${slug}.html`
  if (payload.kind === 'svg') return `${slug}.svg`
  if (payload.kind === 'markdown') return `${slug}.md`
  const extension = CODE_EXTENSIONS[payload.language ?? ''] ?? payload.language ?? 'txt'

  return extension === 'Dockerfile' ? 'Dockerfile' : `${slug}.${extension}`
}

export function artifactMimeType(kind: ArtifactKind): string {
  if (kind === 'html') return 'text/html'
  if (kind === 'svg') return 'image/svg+xml'
  if (kind === 'markdown') return 'text/markdown'

  return 'text/plain'
}

/** A fence long enough that no backtick run inside the content closes it. */
export function fencedSource(content: string, language: string): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((match) => match[0].length))
  const fence = '`'.repeat(longest + 1)

  return `${fence}${language}\n${content}\n${fence}`
}

export function artifactLineCount(content: string): number {
  return content.split('\n').length
}
