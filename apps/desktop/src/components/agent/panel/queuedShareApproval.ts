import { useMemo } from 'react'

import { t } from '../../../i18n'

import { waitingMessages } from './queuedAutoSend'
import { useShareApprovalWait } from './useShareApprovalWait'

import type { Tab } from './model'
import type { RuntimeControl } from './RuntimeSelector'

type ShareApproval = 'pending' | 'denied'

/** The teammate's computer this conversation runs on, by the name its owner gave it. */
export function sharedComputerLabel({ value, options }: RuntimeControl): string {
  return (
    options?.find((instance) => instance.id === value?.id)?.local?.deviceLabel ?? t('this computer')
  )
}

/** What a conversation on a computer shared at "Ask me first" waits for, or that it was declined. */
export function shareApprovalText(status: ShareApproval, computer: string): string {
  return status === 'pending'
    ? t('Waiting for the owner of {computer} to approve. Your message is sent once they do.', {
        computer,
      })
    : t('The owner of {computer} declined this conversation.', { computer })
}

/**
 * Where an open conversation says that it waits for the owner of a teammate's computer, or was
 * declined: on its queued messages when it has any, since the banner above the composer would
 * cover them, and in that banner otherwise. Asked once here for both.
 */
export function useQueuedShareApproval(
  control: RuntimeControl | undefined,
  tab: Tab | null | undefined,
): {
  runtimeControl: RuntimeControl | undefined
  queuedApproval: { status: ShareApproval; text: string } | null
} {
  const status = useShareApprovalWait(control, control?.sessionId)
  const inQueue = Boolean(status) && Boolean(tab && waitingMessages(tab).length > 0)
  const runtimeControl = useMemo(
    () => control && { ...control, shareApproval: inQueue ? null : status },
    [control, inQueue, status],
  )
  const queuedApproval = useMemo(
    () =>
      control && status && inQueue
        ? { status, text: shareApprovalText(status, sharedComputerLabel(control)) }
        : null,
    [control, inQueue, status],
  )

  return { runtimeControl, queuedApproval }
}
