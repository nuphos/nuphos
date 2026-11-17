import { agentHostAway } from '@/lib/claude-code-preview/openab-acp-connect'

import type { PendingUserMessage } from './pending-messages'

// A computer's tunnel redials for about 20s after it drops, so a turn that finds it
// offline waits in the queue. One still offline after this is gone; its senders are told.
const OFFLINE_GRACE_MS = 60_000

/** Whether `message` has waited on its computer for less than the grace. */
export const withinOfflineGrace = (message: PendingUserMessage) =>
  Date.now() - Date.parse(message.offlineSince ?? new Date().toISOString()) < OFFLINE_GRACE_MS

export const reconnecting = (error: unknown, message: PendingUserMessage) =>
  agentHostAway(error) && withinOfflineGrace(message)
