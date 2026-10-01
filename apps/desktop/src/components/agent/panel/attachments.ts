import { api } from '../../../api.ts'
import { toast } from '../../ui/toast.ts'

import { optimisticSenderMetadata } from './optimisticSender.ts'
import { markMessageSent } from './sentMessageMotion.ts'
import { uid } from './stall.ts'
import { fileNameFromPath } from './textUtils.ts'

import type { Message } from './model'
import type { ImageAttachmentPart, TransferUploadPart } from './parts'
import type { UserInfo } from '../../../types'

// Build the optimistic-upload turn helpers. Shared by the active-tab
// dispatch path and the home-tab (new chat) path: the user message renders
// immediately with a loading card, the upload streams to S3 in the background,
// and the resolved `transfer-upload` part is patched in once it finalizes.
// Attachments that should be read by the model as vision rather than
// uploaded to the sandbox. Everything else (code, logs, archives, directories)
// keeps the transfer-upload flow.
export const IMAGE_ATTACHMENT_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

export function isImageAttachmentPath(p: string): boolean {
  return IMAGE_ATTACHMENT_EXTS.has(p.toLowerCase().split('.').pop() ?? '')
}
// True while a file/image drag is over a drop target. During dragover
// `dataTransfer.files` is empty — the only reliable signal is the `Files` type.
export function dataTransferHasFiles(dt: DataTransfer | null): boolean {
  return dt != null && Array.from(dt.types ?? []).includes('Files')
}
export function partitionAttachments(filePaths: string[]): {
  imagePaths: string[]
  otherPaths: string[]
} {
  const imagePaths: string[] = []
  const otherPaths: string[] = []

  for (const p of filePaths) (isImageAttachmentPath(p) ? imagePaths : otherPaths).push(p)

  return { imagePaths, otherPaths }
}
// Read image attachments into vision parts via the main process (bytes →
// downscaled data URL). Unreadable images are skipped; the caller still sends
// the turn. Reading is local and fast, so this doesn't gate the UI noticeably.
export async function readImageParts(imagePaths: string[]): Promise<ImageAttachmentPart[]> {
  const parts: ImageAttachmentPart[] = []

  for (const path of imagePaths) {
    try {
      const img = await api.readImageAttachment(path)

      if (img)
        parts.push({
          type: 'image',
          mediaType: img.mediaType,
          url: img.url,
          fileName: img.fileName,
          path,
          attachmentId: img.attachmentId,
        })
      else toast.error('Could not read image', `${fileNameFromPath(path)} was skipped.`)
    } catch {
      // Surface rather than silently dropping a user-selected image. Local
      // file read — hand-authored copy, the raw error adds nothing.
      toast.error('Could not read image', `${fileNameFromPath(path)} was skipped.`)
    }
  }

  return parts
}

// Build a turn's user message + (optional) upload machinery. Images are already
// resolved to vision parts; only `otherPaths` go through the transfer-upload
// flow, so the upload bits no-op when the turn is images-only / text-only.
export function makeAttachmentTurn(
  text: string,
  imageParts: ImageAttachmentPart[],
  otherPaths: string[],
  teamId: string,
  { turnKind, currentUser }: { turnKind?: Message['turnKind']; currentUser?: UserInfo | null } = {},
) {
  const trimmed = text.trim()
  const messageId = uid()

  markMessageSent(messageId)
  const createdAt = Date.now()
  const metadata = optimisticSenderMetadata(currentUser, createdAt)
  const optimisticPart = (): TransferUploadPart => ({
    type: 'transfer-upload',
    groupId: '',
    status: 'uploading',
    files: otherPaths.map((p) => ({
      fileName: fileNameFromPath(p),
      size: null,
      status: 'uploading',
    })),
  })
  const buildUserMsg = (uploadPart: TransferUploadPart | null): Message => ({
    id: messageId,
    role: 'user',
    parts: [
      ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
      ...imageParts,
      ...(uploadPart ? [uploadPart] : []),
    ],
    createdAt,
    ...(metadata ? { metadata } : {}),
    ...(turnKind ? { turnKind } : {}),
  })
  const runUpload = (sessionId: string | undefined): Promise<TransferUploadPart> =>
    api
      .fileTransferUpload({
        teamId,
        ...(sessionId ? { sessionId } : {}),
        filePaths: otherPaths,
      })
      .then((group) => ({
        type: 'transfer-upload' as const,
        groupId: group.groupId,
        status: 'ready' as const,
        ...(group.archive ? { archive: true as const } : {}),
        ...(group.archiveEntryCount != null ? { archiveEntryCount: group.archiveEntryCount } : {}),
        files: group.files.map((f) => ({ fileName: f.fileName, size: f.size, status: f.status })),
      }))

  return { messageId, optimisticPart, buildUserMsg, runUpload }
}
