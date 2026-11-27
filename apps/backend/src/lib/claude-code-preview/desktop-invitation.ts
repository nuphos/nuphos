// Who besides its owner reaches a conversation's desktop: a teammate who may reply in the
// conversation watches it live, and takes it over while an open `computer` card names that
// display. Nothing is stored: once the card is answered they keep watching, read-only, and
// once they can no longer reply their stream ends.
import { openInputRequests } from '@/lib/agent/db/pending-decision'
import { canReplyIn } from '@/lib/agent/devices/conversation-computer'

import type { AgentConversation } from '@/lib/agent/db'
import type { LocalRuntimeRef } from '@/lib/agent/devices/local-runtime/address'

export type Invited = 'view' | 'control'

/** How often an open stream re-runs the check that let its viewer in. */
export const INVITE_RECHECK_MS = 2_000
/** How long one of those checks may take before it counts as no invitation. */
export const INVITE_WAIT_MS = 5_000

/** What `userId`, who is not the owner, may do with the conversation's `display`: nothing, watch, or take over. */
export async function desktopInvitation(
  conversation: AgentConversation,
  ref: LocalRuntimeRef,
  display: number,
  userId: string,
): Promise<Invited | undefined> {
  // A conversation shared to read is not an invitation: they must also be able to reply.
  if (conversation.archivedAt || !(await canReplyIn(conversation, userId))) return undefined

  const asked = openInputRequests(conversation).some(
    (r) =>
      r.category === 'computer' &&
      r.desktop?.deviceId === ref.deviceId &&
      r.desktop.display === display,
  )

  return asked ? 'control' : 'view'
}

/**
 * Asks `invitedNow` every `ms` and hands the answer to `apply`; a refusal, a failure or no
 * answer within `wait` is no invitation. Tests shorten both; unset, they are the constants. One check at a time, so an older answer never
 * overwrites a newer one. `apply` ends the stream itself, so a throw there is dropped and the
 * next check applies again.
 */
export function recheckInvitation(
  invitedNow: () => Promise<Invited | undefined>,
  ms: number | undefined,
  apply: (now: Invited | undefined) => void,
  wait = ms ?? INVITE_WAIT_MS,
): () => void {
  let checking = false
  const timer = setInterval(() => {
    if (checking) return
    checking = true
    let late: ReturnType<typeof setTimeout> | undefined

    void Promise.race([
      invitedNow(),
      new Promise<undefined>((resolve) => {
        late = setTimeout(() => {
          resolve(undefined)
        }, wait)
      }),
    ])
      .catch(() => undefined)
      .then(apply)
      .catch(() => {})
      .finally(() => {
        clearTimeout(late)
        checking = false
      })
  }, ms ?? INVITE_RECHECK_MS)

  return () => clearInterval(timer)
}
