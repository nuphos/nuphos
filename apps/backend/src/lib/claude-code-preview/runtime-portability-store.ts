import { assertNotChannel } from '@/lib/agent/db/channels'
import { agentConversations } from '@/lib/agent/db/shared'
import { db } from '@/lib/db'

import { refusal } from './runtime-refusal'

/** The retired hosted-runtime teardown kept one job per runtime here; nothing starts one
 *  any more, so a removed runtime only takes its leftover job with it. */
export async function discardRuntimeDeletion(teamId: string, runtimeId: string): Promise<void> {
  await db()
    .collection<{ _id: string; teamId: string }>('agent_runtime_deletions')
    .deleteOne({ _id: runtimeId, teamId })
}

/** Checked after turn admission as well as before attaching a native session. A move refuses
 *  the turn for now: it is sent again, and the move's release starts it there (#5376). */
export async function assertConversationRuntimeAvailable(sessionId: string) {
  const conversation = await agentConversations().findOne(
    { sessionId },
    { projection: { runtimeOperation: 1, kind: 1 } },
  )

  // Every turn claims its session through here, so this is the one place a
  // channel refuses them: it has no agent of its own to run.
  assertNotChannel(conversation)
  if (conversation?.runtimeOperation && conversation.runtimeOperation.expiresAt > new Date())
    throw refusal('This conversation is being moved. Please wait for the move to finish.')
}
