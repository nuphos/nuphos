// Who besides its owner reaches a conversation's desktop: a teammate who may reply in the
// conversation watches it live, and takes it over only while an open `computer` card names
// that display. Nothing is stored: once the card is answered they keep watching, read-only.
import { openInputRequests } from '@/lib/agent/db/pending-decision'
import { canReplyIn } from '@/lib/agent/devices/conversation-computer'

import type { AgentConversation } from '@/lib/agent/db'
import type { LocalRuntimeRef } from '@/lib/agent/devices/local-runtime/address'

export type Invited = 'view' | 'control'

/** How often a teammate's open stream re-runs the check that let them in. */
export const INVITE_RECHECK_MS = 5_000

/** What `userId`, who is not the owner, may do with the conversation's `display`: nothing, watch, or take over. */
export async function desktopInvitation(
  conversation: AgentConversation,
  ref: LocalRuntimeRef,
  display: number,
  userId: string,
): Promise<Invited | undefined> {
  // A conversation shared to read is not an invitation: they must also be able to reply.
  if (conversation.archivedAt || !(await canReplyIn(conversation, userId))) return undefined

  return openInputRequests(conversation).some(
    (r) =>
      r.category === 'computer' &&
      r.desktop?.deviceId === ref.deviceId &&
      r.desktop.display === display,
  )
    ? 'control'
    : 'view'
}

/**
 * Asks `invitedNow` every `ms` and hands the answer to `apply`; a refusal or failure is no
 * invitation. One check at a time, so an older answer never overwrites a newer one.
 */
export function recheckInvitation(
  invitedNow: () => Promise<Invited | undefined>,
  ms: number,
  apply: (now: Invited | undefined) => void,
): () => void {
  let checking = false
  const timer = setInterval(() => {
    if (checking) return
    checking = true
    void invitedNow()
      .catch(() => undefined)
      .then(apply)
      .finally(() => {
        checking = false
      })
  }, ms)

  return () => clearInterval(timer)
}
