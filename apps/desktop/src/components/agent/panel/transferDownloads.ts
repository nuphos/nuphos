import { runtimeIsExecuting } from '../../../lib/runtimeExecution.ts'

import { firstMessageNewerThan } from './messagePlacement.ts'

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
 * transcript — so each is placed by its push time, with the same rule as
 * timeline events (firstMessageNewerThan): the card belongs to the assistant
 * message at that slot, or else to the nearest one before it. A group pushed
 * while a turn runs sits after the message that starts the turn (the user
 * message, or an autonomous reply's own start stamp) and before the next
 * turn's, so it lands on that turn's reply whether or not the client holds the
 * reply's stored time yet, and does not move once it does. A group older than
 * the first loaded message waits for earlier history; with none to wait for it
 * goes to the first reply rather than nowhere — a client clock seconds ahead
 * can stamp the first message after the push.
 */
export function anchorDownloadGroups(
  messages: readonly Message[],
  groups: readonly FileTransferGroup[],
  hasEarlier = false,
): Map<string, FileTransferGroup[]> {
  const byMessage = new Map<string, FileTransferGroup[]>()
  const ordered = [...groups].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  for (const group of ordered) {
    const index = firstMessageNewerThan(messages, Date.parse(group.createdAt))

    if (index === 0 && hasEarlier) continue
    const slot = index < 0 ? messages.length : index + 1
    const anchor =
      messages.slice(0, slot).findLast((m) => m.role === 'assistant') ??
      messages.slice(slot).find((m) => m.role === 'assistant')

    if (!anchor) continue
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
