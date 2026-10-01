// StorageProvider resolution. Today this is just the Zeabur S3 provider keyed
// by config; the seam exists so a future team-level BYOS S3 provider can be
// selected per-team without touching routes or the agent.

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { S3StorageProvider } from './s3-provider'

import type { StorageProvider } from './types'

export type { StorageProvider, StorageObjectRef, PresignedUrl } from './types'

// The default (Zeabur-owned) provider for a team. `teamId` is accepted now
// so the BYOS lookup can slot in later without a signature change.
export function getStorageProvider(_teamId?: string): StorageProvider {
  if (config.fileTransfer.provider === 's3') return S3StorageProvider.fromConfig()
  throw new AppError(
    503,
    'file_transfer_unconfigured',
    `Unknown file transfer provider: ${config.fileTransfer.provider}`,
  )
}
