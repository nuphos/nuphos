import { useState } from 'react'

import { t } from '../../i18n'
import { toast } from '../ui/toast'

import { removePeople } from './channelPeople'
import { computerUseNeeded, needsComputerUse } from './computerUse'
import { ComputerUseConfirm } from './ComputerUseConfirm'
import { joinNames } from './joinNames'

import type { ComputerUseRequest } from './computerUse'
import type { ConversationAccessState } from '../../api/agent-types'

type Apply = (state: ConversationAccessState) => void

/** Tells the remover who can still use the chat's computer, and where that is managed. */
export function noticeStillShared(names: string[], computer: string, onOpenComputers?: () => void) {
  const action = onOpenComputers && { label: t('Open settings'), onClick: onOpenComputers }

  toast.info(
    t('{names} can still use {computer}', { names: joinNames(names), computer }),
    t('Manage who can use it in the computer’s sharing settings.'),
    { timeoutMs: 12_000, ...(action ? { action } : {}) },
  )
}

/**
 * What a chat invite does to its computer: it may give the invitees use of the whole computer,
 * so the invite says how far it goes. Leaving the chat never takes that back; computer use is
 * managed on the computer's sharing settings, so removing someone only says they keep it.
 */
export function useComputerSharing(
  at: { sessionId: string; teamId: string; apply: Apply; onOpenComputers?: () => void },
  channel?: { onAgentsChange: () => void },
) {
  const [request, setRequest] = useState<ComputerUseRequest | null>(null)

  /** An invite refused for want of the computer: ask, then invite again giving it. */
  const confirmGrant =
    (count: number, inviteGiving: () => Promise<void>, then: () => void) => (err: unknown) => {
      if (!needsComputerUse(err)) return toast.apiError(t('Failed to add teammates'), err)
      setRequest({ count, ...computerUseNeeded(err), confirm: () => inviteGiving().then(then) })
    }

  /**
   * Takes people out of the chat one at a time, the first failure stopping the rest, and
   * answers who is still in it. Then one notice names whoever can still use its computer.
   */
  const removeEach = async <P extends { id: string; name: string; agent?: unknown }>(
    people: P[],
    failed: (err: unknown) => void,
  ): Promise<P[]> => {
    const kept: string[] = []
    let computer = ''
    let done = 0

    try {
      for (const person of people) {
        const apply = (state: ConversationAccessState) => {
          at.apply(state)
          if (!state.computerStillShared) return
          kept.push(person.name)
          computer = state.computerStillShared.label
        }

        await removePeople([person], { ...at, apply, onAgentsChange: channel?.onAgentsChange })
        done++
      }
    } catch (err) {
      failed(err)
    }
    if (kept.length) noticeStillShared(kept, computer, at.onOpenComputers)

    return people.slice(done)
  }

  const dialog = <ComputerUseConfirm request={request} onClose={() => setRequest(null)} />

  return { confirmGrant, removeEach, dialog }
}
