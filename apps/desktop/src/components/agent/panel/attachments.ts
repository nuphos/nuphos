import { api } from '../../../api.ts'

import { optimisticSenderMetadata } from './optimisticSender.ts'
import { markMessageSent } from './sentMessageMotion.ts'
import { uid } from './stall.ts'
import { fileNameFromPath } from './textUtils.ts'

import type { Message } from './model'
import type { TransferUploadPart } from './parts'
import type { UserInfo } from '../../../types'

// Build the optimistic-upload turn helpers. Shared by the active-tab
// dispatch path and the home-tab (new chat) path: the user message renders
// immediately with a loading card, the upload streams to S3 in the background,
// and the resolved `transfer-upload` part is patched in once it finalizes.
// Images in the composer get a local thumbnail before sending.
export const IMAGE_ATTACHMENT_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

export function isImageAttachmentPath(p: string): boolean {
  return IMAGE_ATTACHMENT_EXTS.has(p.toLowerCase().split('.').pop() ?? '')
}
// True while a file/image drag is over a drop target. During dragover
// `dataTransfer.files` is empty — the only reliable signal is the `Files` type.
export function dataTransferHasFiles(dt: DataTransfer | null): boolean {
  return dt != null && Array.from(dt.types ?? []).includes('Files')
}
// Build a turn's user message + (optional) upload machinery. Every attachment
// goes through the transfer-upload flow, so the upload bits no-op when the
// turn is text-only.
export function makeAttachmentTurn(
  text: string,
  filePaths: string[],
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
    files: filePaths.map((p) => ({
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
        filePaths: filePaths,
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
