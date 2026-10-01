import { logError } from '@/lib/observability'
import { slackAddressingVerdicts } from '@/lib/slack/agent-bot/collections'

import type { SlackAddressingVerdict } from '@/lib/slack/agent-bot/collections'

/** Total on purpose, like recordSideCallTokenUsage: call sites await it, and a
 *  lost audit row must never change whether the reply gets answered. Upserts on
 *  dedupeKey so a redelivered Slack event or a re-run backfill stays one row. */
export async function recordSlackAddressingVerdict(
  verdict: Omit<SlackAddressingVerdict, '_id'>,
): Promise<void> {
  try {
    await slackAddressingVerdicts().updateOne(
      { dedupeKey: verdict.dedupeKey },
      { $setOnInsert: verdict },
      { upsert: true },
    )
  } catch (err) {
    logError('slack.agent.addressing_verdict_persist.error', err, {
      dedupe_key: verdict.dedupeKey,
      session_id: verdict.sessionId,
      team_id: verdict.teamId,
    })
  }
}
