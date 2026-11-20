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
              'Adding these people also lets them run any chat on {computer}, not just this one. Those chats use the Claude Code or Codex sign-in there, and can read files and run commands as its user.',
              { computer },
            )
          : t(
              'Adding this person also lets them run any chat on {computer}, not just this one. Those chats use the Claude Code or Codex sign-in there, and can read files and run commands as its user.',
              { computer },
            )
      }
      confirmLabel={t('Add and share')}
      onConfirm={() => request?.confirm()}
      onClose={onClose}
    />
  )
}
