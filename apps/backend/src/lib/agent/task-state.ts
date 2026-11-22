import type { ArchiveCleanupState } from './archive-cleanup'
import type { ConversationInputRequests } from './db/pending-decision'

export type ConversationTaskState = ConversationInputRequests &
  ArchiveCleanupState & {
    delegation?: { requestId: string; promptHash: string; ready?: boolean }
    /** Channels that supplied the request when this Task was delegated. Context, not posting authority. */
    originChannelIds?: string[]
    taskReport?: {
      id: string
      status: 'waiting' | 'ready' | 'blocked' | 'failed' | 'done'
      summary: string
      at: Date
    }
  }
