import { useRef, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { toast } from '../ui/toast'

import { ComputerUseConfirm, StopSharingConfirm } from './ComputerUseConfirm'
import { computerUseNeeded, needsComputerUse, nothingToStop } from './computerUse'

import type { StopSharingOffer } from './ComputerUseConfirm'
import type { ComputerUseRequest } from './computerUse'
import type { AgentConversationParticipant, ConversationAccessState } from '../../api/agent-types'

/**
 * What a chat invite does to its computer: it may give the invitees use of the whole computer,
 * which leaving the chat does not take back. So the invite says how far it goes, Undo takes
 * back what it gave, and removing someone offers to stop sharing the computer with them too.
 */
export function useComputerSharing(sessionId: string, teamId: string) {
  const [request, setRequest] = useState<ComputerUseRequest | null>(null)
  const [offer, setOffer] = useState<StopSharingOffer | null>(null)
  // Whom the last confirmed invite gave the computer to: only they lose it on Undo.
  const granted = useRef<string[]>([])
  const stop = (userId: string) => api.agentStopConversationComputerUse(sessionId, teamId, userId)
  /** A new invite: from here the record is of what it gives, nothing earlier. */
  const startInvite = () => {
    granted.current = []
  }

  /** An invite refused for want of the computer: ask, then invite again giving it. */
  const confirmGrant =
    (count: number, inviteGiving: () => Promise<void>, then: () => void) => (err: unknown) => {
      if (!needsComputerUse(err)) return toast.apiError(t('Failed to add teammates'), err)
      const needed = computerUseNeeded(err)

      setRequest({
        count,
        ...needed,
        confirm: () =>
          inviteGiving().then(() => {
            granted.current = needed.userIds
            then()
          }),
      })
    }

  /**
   * Undoing that invite: each person leaves the chat, then the computer goes back to who had
   * it, without asking. Answers whom it is not done for yet (a removal or a stop failed): they
   * stay on record, so Undo again finishes it.
   */
  const undoInvite = async <P extends { id: string }>(
    people: P[],
    removeOne: (person: P) => Promise<void>,
  ): Promise<P[]> => {
    const removed: P[] = []

    try {
      for (const person of people) {
        await removeOne(person)
        removed.push(person)
      }
    } catch (err) {
      toast.apiError(t('Failed to undo'), err)
    }
    const theirs = granted.current.filter((id) => removed.some((person) => person.id === id))
    const results = await Promise.allSettled(theirs.map((id) => stop(id)))
    const failures = results.flatMap((result, i) =>
      result.status === 'rejected' && !nothingToStop(result.reason)
        ? [{ id: theirs[i], reason: result.reason as unknown }]
        : [],
    )
    const done = theirs.filter((id) => !failures.some((failure) => failure.id === id))

    granted.current = granted.current.filter((id) => !done.includes(id))
    if (failures.length) toast.apiError(t('Failed to undo'), failures[0].reason)

    return people.filter(
      (person) => !removed.includes(person) || failures.some((failure) => failure.id === person.id),
    )
  }

  /** Applies a removal's answer, then, if they may still use the computer, offers to stop that. */
  const thenOffer =
    (apply: (state: ConversationAccessState) => void, person: AgentConversationParticipant) =>
    (state: ConversationAccessState) => {
      apply(state)
      if (state.computerStillShared)
        setOffer({
          userId: person.id,
          name: person.name,
          computer: state.computerStillShared.label,
        })
    }

  const stopSharing = async (target: StopSharingOffer): Promise<void> => {
    try {
      await stop(target.userId)
      toast.success(t('Stopped sharing {computer} with {name}', target), undefined, {
        dedupe: true,
      })
    } catch (err) {
      toast.apiError(t('Could not stop sharing {computer}', target), err)
    }
  }

  const dialogs = (
    <>
      <ComputerUseConfirm request={request} onClose={() => setRequest(null)} />
      <StopSharingConfirm offer={offer} onStop={stopSharing} onClose={() => setOffer(null)} />
    </>
  )

  return { startInvite, confirmGrant, undoInvite, thenOffer, dialogs }
}
