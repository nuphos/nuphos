import { firstMessageNewerThan } from './messagePlacement.ts'

import type { Message, Tab } from './model'
import type { FileTransferGroup } from '../../../types'

// GET …/file-transfers/downloads is owner-only; a teammate viewing read-only gets a 403.
// It is read whatever the runtime is doing: a conversation opened mid-turn
// still shows the files its earlier turns sent.
export function shouldLoadTransferDownloads(tab: Tab | undefined): tab is Tab {
  if (!tab?.sessionId || tab.foreign) return false

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
    // Auto-uploaded reply images already render at their Markdown position.
    if (
      group.label === 'Reply image' &&
      messages.some((message) =>
        message.parts.some(
          (part) =>
            part.type === 'text' &&
            part.text.includes(`https://nuphos.ai/_reply-images/${group.groupId}`),
        ),
      )
    )
      continue
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

// The one square every inline image and video preview gets, loading or loaded,
// so media never resizes the transcript when it arrives. The preview opens full size.
export const MEDIA_BOX = 'h-20 w-20'

// The most of a PDF a preview reads into memory. Media streams from its URL and
// is never read whole; a PDF has to be, so a bigger one is left to Download.
export const PDF_PREVIEW_BYTES_MAX = 25 * 1024 * 1024

// The frame that square sits in, shared by an image and one still arriving. A
// video, an audio player and a PDF frame size themselves.
export const MEDIA_FRAME = `block rounded-lg border border-line-control bg-surface-sheet ${MEDIA_BOX}`

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm)$/i
const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i
const PDF_EXTENSIONS = /\.pdf$/i

// Images, videos and audio the agent sent are shown, not just offered for
// download: each is a square that the lightbox opens and plays. PDFs stay rows.
// Agent pushes often carry no content type, so the file name decides then.
export function previewKind(file: {
  fileName: string
  status: string
  contentType?: string | null
}): Exclude<ViewerKind, 'pdf'> | null {
  const kind = file.status === 'ready' ? viewerKind(file.fileName, file.contentType) : null

  return kind === 'pdf' ? null : kind
}

export function mediaKind(fileName: string, contentType?: string | null): 'image' | 'video' | null {
  const type = contentType ?? ''

  if (type.startsWith('image/') || (!type && IMAGE_EXTENSIONS.test(fileName))) return 'image'
  if (type.startsWith('video/') || (!type && VIDEO_EXTENSIONS.test(fileName))) return 'video'

  return null
}

/** How an inline preview shows a file. Anything else is offered, not shown. */
export type ViewerKind = 'image' | 'video' | 'audio' | 'pdf'

/**
 * Which viewer an inline preview sends a file to: the images and videos above,
 * plus audio and PDFs. The same rule as `mediaKind` — the content type decides
 * when the push carries one, and the file name decides when it does not.
 */
export function viewerKind(fileName: string, contentType?: string | null): ViewerKind | null {
  const media = mediaKind(fileName, contentType)

  if (media) return media
  const type = contentType ?? ''

  if (type.startsWith('audio/') || (!type && AUDIO_EXTENSIONS.test(fileName))) return 'audio'
  if (type === 'application/pdf' || (!type && PDF_EXTENSIONS.test(fileName))) return 'pdf'

  return null
}

/**
 * The files a card still lists as rows beside its previews. While previews
 * resolve (`previewed` null) the files that should become squares are held
 * back; once resolved, every file that did not become one is listed — a failed
 * or unresolved one included. A previewed file is saved from the lightbox.
 */
export function filesBesidePreviews<T extends { fileName: string; status: string }>(
  files: readonly T[],
  previewed: ReadonlySet<string> | null,
): T[] {
  return files.filter((f) => (previewed ? !previewed.has(f.fileName) : !previewKind(f)))
}

export function formatTransferBytes(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
