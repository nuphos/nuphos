import { t } from '../../i18n'
import { AppAlertDialog } from '../ui/alert-dialog'

import type { ComputerUseRequest } from './computerUse'

/**
 * Taking part in a session means using the computer it runs on, so inviting someone who
 * cannot asks first. It says how far that goes: the whole computer, not only this chat.
 */
export function ComputerUseConfirm({
  request,
  onClose,
}: {
  request: ComputerUseRequest | null
  onClose: () => void
}) {
  const computer = request?.computer ?? t('this computer')

  return (
    <AppAlertDialog
      open={request !== null}
      title={t('Also share {computer}?', { computer })}
      description={
        (request?.count ?? 0) > 1
          ? t(
              'Adding these people also lets them run any chat on {computer}, not just this one. Those chats use the Claude Code or Codex sign-in there, and its agents can read files and run commands as its user.',
              { computer },
            )
          : t(
              'Adding this person also lets them run any chat on {computer}, not just this one. Those chats use the Claude Code or Codex sign-in there, and its agents can read files and run commands as its user.',
              { computer },
            )
      }
      confirmLabel={t('Add and share')}
      onConfirm={() => request?.confirm()}
      onClose={onClose}
    />
  )
}

/** Someone removed from a chat who may still use its computer, which the remover can stop. */
export type StopSharingOffer = { userId: string; name: string; computer: string }

/** After a removal: the chat is gone for them, but the computer is not unless this says so. */
export function StopSharingConfirm({
  offer,
  onStop,
  onClose,
}: {
  offer: StopSharingOffer | null
  onStop: (offer: StopSharingOffer) => Promise<void>
  onClose: () => void
}) {
  const words = { name: offer?.name ?? '', computer: offer?.computer ?? '' }

  return (
    <AppAlertDialog
      open={offer !== null}
      title={t('Also stop sharing {computer} with {name}?', words)}
      description={t(
        '{name} is out of this chat, but can still use {computer} for any chat, on the Claude Code or Codex sign-in there. Stopping also closes what they have open on it.',
        words,
      )}
      confirmLabel={t('Stop sharing')}
      cancelLabel={t('Keep sharing')}
      destructive
      onConfirm={() => (offer ? onStop(offer) : undefined)}
      onClose={onClose}
    />
  )
}
