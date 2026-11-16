import { AppError } from '@/lib/errors'

import type { PendingUserMessage } from './pending-messages'

// A computer's tunnel redials for about 20s after it drops, so a turn that finds it
// offline waits in the queue. One still offline after this is gone; its senders are told.
const OFFLINE_GRACE_MS = 60_000

export const reconnecting = (error: unknown, message: PendingUserMessage) =>
  error instanceof AppError &&
  error.code === 'runtime_offline' &&
  Date.now() - Date.parse(message.offlineSince ?? new Date().toISOString()) < OFFLINE_GRACE_MS
