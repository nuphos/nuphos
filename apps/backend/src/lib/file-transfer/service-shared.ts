import { ObjectId } from 'mongodb'

import type { getStorageProvider } from '@/lib/storage'
import type {
  FileTransferDirection,
  FileTransferGroup,
  FileTransferGroupStatus,
  FileTransferItem,
} from '@/models'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { fileTransferGroups } from '@/models'

export type TransferScope = {
  teamId: ObjectId
  userId: string
  // Present in agent context; scopes the group to a conversation.
  sessionId?: string
}

export type FileIntentInput = {
  fileName: string
  relPath?: string
  size: number
  contentType?: string | null
}

export type CreatedItemView = {
  id: string
  fileName: string
  relPath: string
  uploadUrl: string
  expiresAt: string
}

export type CreatedTransferView = {
  groupId: string
  direction: FileTransferDirection
  status: FileTransferGroupStatus
  expiresAt: string
  files: CreatedItemView[]
}

export type ResolvedFileView = {
  id: string
  fileName: string
  relPath: string
  size: number | null
  contentType: string | null
  status: FileTransferItem['status']
  // Present only for items that are ready to download.
  downloadUrl?: string
  downloadExpiresAt?: string
}

export type TransferGroupView = {
  groupId: string
  direction: FileTransferDirection
  status: FileTransferGroupStatus
  label: string | null
  createdAt: string
  expiresAt: string
  files: ResolvedFileView[]
}

export function objectKey(teamId: ObjectId, groupId: ObjectId, itemId: ObjectId): string {
  return `transfers/${teamId.toHexString()}/${groupId.toHexString()}/${itemId.toHexString()}`
}

export function validateInputs(files: FileIntentInput[]): void {
  const cfg = config.fileTransfer

  if (files.length === 0) {
    throw new AppError(400, 'no_files', 'At least one file is required')
  }
  if (files.length > cfg.maxFiles) {
    throw new AppError(
      413,
      'too_many_files',
      `At most ${String(cfg.maxFiles)} files per transfer`,
      {
        max: cfg.maxFiles,
        requested: files.length,
      },
    )
  }
  let total = 0

  for (const f of files) {
    if (!f.fileName.trim()) {
      throw new AppError(400, 'invalid_file_name', 'File name is required')
    }
    if (!Number.isSafeInteger(f.size) || f.size <= 0 || f.size > cfg.maxBytes) {
      throw new AppError(
        413,
        'file_too_large',
        `Each file must be 1..${String(cfg.maxBytes)} bytes`,
        {
          max: cfg.maxBytes,
          fileName: f.fileName,
          size: f.size,
        },
      )
    }
    total += f.size
  }
  if (total > cfg.maxTotalBytes) {
    throw new AppError(
      413,
      'transfer_too_large',
      `Total transfer exceeds ${String(cfg.maxTotalBytes)} bytes`,
      {
        max: cfg.maxTotalBytes,
        total,
      },
    )
  }
}

export async function loadGroup(scope: TransferScope, groupId: string): Promise<FileTransferGroup> {
  if (!ObjectId.isValid(groupId)) {
    throw new AppError(400, 'invalid_id', `Invalid transfer group id: ${groupId}`)
  }
  const group = await fileTransferGroups().findOne({
    _id: new ObjectId(groupId),
    teamId: scope.teamId,
    userId: scope.userId,
    // When the caller is agent-session-scoped, restrict to this conversation's
    // own groups so one session can't read/finalize/download another
    // conversation's transfer (same user/team). Team-scoped groups (no
    // sessionId) stay reachable — that's how a brand-new chat's first-message
    // attachment is stored before its agent session exists.
    ...(scope.sessionId
      ? { $or: [{ sessionId: scope.sessionId }, { sessionId: { $exists: false } }] }
      : {}),
  })

  if (!group) {
    throw new AppError(404, 'transfer_not_found', 'File transfer not found')
  }
  if (group.expiresAt.getTime() <= Date.now()) {
    throw new AppError(410, 'transfer_expired', 'File transfer has expired')
  }

  return group
}

export function groupStatusFrom(items: FileTransferItem[]): FileTransferGroupStatus {
  const ready = items.filter((i) => i.status === 'ready').length

  if (ready === items.length) return 'ready'
  if (ready === 0) return 'failed'

  return 'partial'
}

export async function view(
  group: FileTransferGroup,
  items: FileTransferItem[],
  provider?: ReturnType<typeof getStorageProvider>,
): Promise<TransferGroupView> {
  const files: ResolvedFileView[] = []

  for (const item of items) {
    const base: ResolvedFileView = {
      id: item._id.toHexString(),
      fileName: item.fileName,
      relPath: item.relPath ?? item.fileName,
      size: item.actualSize ?? item.declaredSize ?? null,
      contentType: item.contentType,
      status: item.status,
    }

    if (provider && item.status === 'ready') {
      const presigned = await provider.presignDownload(
        { bucket: item.bucket, region: item.region, key: item.objectKey },
        item.fileName,
        config.fileTransfer.presignExpirySeconds,
      )

      base.downloadUrl = presigned.url
      base.downloadExpiresAt = presigned.expiresAt.toISOString()
    }
    files.push(base)
  }

  return {
    groupId: group._id.toHexString(),
    direction: group.direction,
    status: group.status,
    label: group.label ?? null,
    createdAt: group.createdAt.toISOString(),
    expiresAt: group.expiresAt.toISOString(),
    files,
  }
}
