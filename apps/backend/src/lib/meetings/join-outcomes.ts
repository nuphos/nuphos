import { agentConversations } from '@/lib/agent/db/shared'
import { logEvent } from '@/lib/observability'

import { logMeetingBotFailure, meetingBotStatus } from './recall'

import type { AgentConversation } from '@/lib/agent/db'

// One outcome per meeting bot sent: request_failed and fatal are logged where they happen, and
// these are the rest, joined, failed_before_join and join_timeout.

/** Which product a meeting link is for, so a bot sent to the wrong one shows without its link. */
export function meetingPlatform(url: string): string {
  const host = URL.parse(url)?.hostname ?? ''
  const platforms: [string, RegExp][] = [
    ['google_meet', /(^|\.)meet\.google\.com$/],
    ['zoom', /(^|\.)zoom\.(us|com)$/],
    ['teams', /(^|\.)teams\.(microsoft|live)\.com$/],
    ['webex', /(^|\.)webex\.com$/],
  ]

  return platforms.find(([, pattern]) => pattern.test(host))?.[0] ?? 'other'
}

/** A bot that is not in its call this long after it was sent never got in. */
export const JOIN_TIMEOUT_MS = 30 * 60_000

/**
 * Logs each bot sent between `JOIN_TIMEOUT_MS` and one `windowMs` earlier that has not ended and,
 * by Recall's own account, never got into its call. Asking Recall once per bot covers a status
 * webhook that never came. Each run looks at its own window, so a bot is reported once per replica.
 */
export async function reportJoinTimeouts(windowMs: number, now = Date.now()): Promise<void> {
  const to = new Date(now - JOIN_TIMEOUT_MS)
  const from = new Date(to.getTime() - windowMs)
  // A Task is never last active before it was created: this bound uses the lastActiveAt index.
  const waiting = await agentConversations()
    .find({
      lastActiveAt: { $gte: from },
      createdAt: { $gte: from, $lt: to },
      'meeting.botId': { $exists: true },
      'meeting.endedAt': { $exists: false },
    })
    .toArray()

  for (const task of waiting) {
    const botId = task.meeting?.botId ?? ''
    // A refused request is already logged as request_failed.
    const status = await meetingBotStatus(botId).catch(() => null)

    if (status && !status.joined)
      logMeetingBotFailure('join_timeout', {
        code: status.last?.code,
        sub_code: status.last?.sub_code,
        bot_id: botId,
        session_id: task.sessionId,
        platform: meetingPlatform(task.meeting?.url ?? ''),
      })
  }
}

/**
 * How a bot's attempt ended, logged on its first call_ended: it got in, or its call ended before
 * it did (a waiting room nobody opened ends this way, not as bot.fatal). A bot its Task told to
 * leave before it got in was cancelled, which is neither.
 */
export async function logJoinOutcome(
  task: AgentConversation,
  ended: { code?: string; sub_code?: string | null },
): Promise<void> {
  const { botId, url } = task.meeting ?? { botId: '', url: '' }
  // A refused request is already logged as request_failed.
  const status = await meetingBotStatus(botId).catch(() => null)
  const details = {
    code: ended.code,
    sub_code: ended.sub_code,
    bot_id: botId,
    session_id: task.sessionId,
    platform: meetingPlatform(url),
  }

  if (!status) return
  if (status.joined) logEvent('info', 'meeting_bot.joined', details)
  else if (ended.sub_code !== 'bot_received_leave_call')
    logMeetingBotFailure('failed_before_join', details)
}
