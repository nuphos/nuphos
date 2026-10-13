import { runtimeIsExecuting } from '../../../lib/runtimeExecution.ts'

import type { Message, Tab } from './model'
import type { FileTransferFile, FileTransferGroup } from '../../../types'

// GET …/file-transfers/downloads is owner-only; a teammate viewing read-only gets a 403.
// Files land while the runtime executes, so read once it stops. `tab.streaming`
// is only the transport: a reopened runtime conversation stays attached while
// idle, and gating on it never read the store again.
export function shouldLoadTransferDownloads(tab: Tab | undefined): tab is Tab {
  if (!tab?.sessionId || runtimeIsExecuting(tab.runtimeState) || tab.foreign) return false

  return tab.messages.some((m) => m.role === 'assistant')
}

/**
 * Which assistant message each download card belongs under. The transfer store
 * is the source of truth for these cards — they are never written into the
 * transcript — so the anchor is derived from times instead: a group is pushed
 * while a turn runs, and that turn's assistant message is stamped when the turn
 * ends, so the group belongs to the earliest assistant message stamped at or
 * after it. Groups newer than every stamp belong to the last assistant message —
 * the turn that just finished, whose stored time the client does not hold until
 * the next transcript read. Until then several turns' cards can sit under that
 * last reply; they move to their own turns once the stamps arrive.
 */
export function anchorDownloadGroups(
  messages: readonly Message[],
  groups: readonly FileTransferGroup[],
): Map<string, FileTransferGroup[]> {
  const anchors = messages.flatMap((m) =>
    m.role === 'assistant' ? [{ id: m.id, createdAt: m.createdAt }] : [],
  )
  const byMessage = new Map<string, FileTransferGroup[]>()
  const last = anchors.at(-1)

  if (!last) return byMessage
  const ordered = [...groups].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  for (const group of ordered) {
    const pushedAt = Date.parse(group.createdAt)
    const anchor = anchors.find((a) => a.createdAt !== undefined && a.createdAt >= pushedAt) ?? last
    const list = byMessage.get(anchor.id) ?? []

    list.push(group)
    byMessage.set(anchor.id, list)
  }

  return byMessage
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm)$/i

// Images and videos the agent sent are shown, not just offered for download.
// Agent pushes often carry no content type, so the file name decides then.
export function previewKind(file: FileTransferFile): 'image' | 'video' | null {
  return file.status === 'ready' ? mediaKind(file.fileName, file.contentType) : null
}

export function mediaKind(fileName: string, contentType?: string | null): 'image' | 'video' | null {
  const type = contentType ?? ''

  if (type.startsWith('image/') || (!type && IMAGE_EXTENSIONS.test(fileName))) return 'image'
  if (type.startsWith('video/') || (!type && VIDEO_EXTENSIONS.test(fileName))) return 'video'

  return null
}

/**
 * The files a card still lists as rows beside its previews. While previews
 * resolve (`previewedImages` null) only images that should become thumbnails
 * are held back; once resolved, every file that did not become one is listed —
 * a failed or unresolved image included. Videos keep their row (and its
 * Download button): the lightbox only steps through images.
 */
export function filesBesidePreviews<T extends { fileName: string; status: string }>(
  files: readonly T[],
  previewedImages: ReadonlySet<string> | null,
): T[] {
  return files.filter((f) =>
    previewedImages
      ? !previewedImages.has(f.fileName)
      : !(f.status === 'ready' && mediaKind(f.fileName) === 'image'),
  )
}
