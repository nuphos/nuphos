import type { ArchiveCleanupState } from './archive-cleanup'
import type { CreatedTriggersState } from './created-triggers-state'
import type { ConversationInputRequests } from './db/pending-decision'

export type ConversationTaskState = ConversationInputRequests &
  ArchiveCleanupState &
  CreatedTriggersState & {
    delegation?: { requestId: string; promptHash: string; ready?: boolean }
    /** Channels that supplied the request when this Task was delegated. Context, not posting authority. */
    originChannelIds?: string[]
    taskReport?: {
      id: string
      status: 'waiting' | 'ready' | 'blocked' | 'failed' | 'done'
      summary: string
      data?: Record<string, unknown>
      at: Date
    }
  }
