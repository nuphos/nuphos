// HTML and Markdown files opened for preview in the dock (an agent's pushed
// file, a chat attachment), shown by the artifact tab: HTML in the locked
// file frame (no script, no network), Markdown as a document. Nothing is
// persisted: the file is read again when its card is clicked, and only the
// last few stay in memory.

import type { ArtifactVersion } from '../components/agent/artifacts/artifactPayload'

/**
 * Preview ids share the artifact tab's route with real artifacts. Theirs only
 * ever match /^[a-z0-9][a-z0-9-]*$/, so the `~` prefix can never collide.
 */
const PREFIX = '~file-'
const MAX_PREVIEWS = 12

const previews = new Map<string, ArtifactVersion>()
const listeners = new Set<() => void>()

const HTML_FILE = /\.(html?|xhtml)$/i
const MARKDOWN_FILE = /\.(md|markdown|mdx?)$/i

export type FilePreviewKind = 'html' | 'markdown'

/** How the dock renders a file, by its extension; null when it only downloads. */
export function filePreviewKind(fileName: string): FilePreviewKind | null {
  const name = fileName.trim()

  if (HTML_FILE.test(name)) return 'html'
  if (MARKDOWN_FILE.test(name)) return 'markdown'

  return null
}

/** A file the dock can render as a page. */
export function isHtmlFileName(fileName: string): boolean {
  return filePreviewKind(fileName) === 'html'
}

export function filePreviewId(groupId: string, fileId: string): string {
  return `${PREFIX}${groupId}-${fileId}`
}

export function isFilePreviewId(id: string): boolean {
  return id.startsWith(PREFIX)
}

/** The page title a preview gets: its file name without the extension. */
export function filePreviewTitle(fileName: string): string {
  const name = fileName.trim().split(/[\\/]/).pop() ?? fileName

  return name.replace(HTML_FILE, '').replace(MARKDOWN_FILE, '') || name
}

/** Hold a file's text for its dock tab; reopening the same file refreshes it. */
export function putFilePreview(id: string, fileName: string, text: string): void {
  previews.delete(id)
  previews.set(id, {
    artifactId: id,
    title: filePreviewTitle(fileName),
    kind: filePreviewKind(fileName) ?? 'html',
    content: text,
    toolCallId: id,
    version: 1,
    createdAt: Date.now(),
  })
  // Oldest first in a Map: drop from the front once over the limit.
  while (previews.size > MAX_PREVIEWS) {
    const oldest = previews.keys().next().value

    if (oldest === undefined) break
    previews.delete(oldest)
  }
  for (const listener of listeners) listener()
}

export function readFilePreview(id: string): ArtifactVersion | undefined {
  return previews.get(id)
}

export function subscribeFilePreviews(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
