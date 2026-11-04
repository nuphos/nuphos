import { t } from '../../i18n'
import { AppAlertDialog } from '../ui/alert-dialog'

import type { ComputerUseRequest } from './computerUse'

/**
 * Taking part in a session means using the computer it runs on, so inviting
 * someone who cannot asks first.
 */
export function ComputerUseConfirm({
  request,
  onClose,
}: {
  request: ComputerUseRequest | null
  onClose: () => void
}) {
  return (
    <AppAlertDialog
      open={request !== null}
      title={t('Also give use of this computer?')}
      description={
        (request?.count ?? 0) > 1
          ? t(
              'Adding these people to the conversation also gives them use of this computer. Continue?',
            )
          : t(
              'Adding this person to the conversation also gives them use of this computer. Continue?',
            )
      }
      confirmLabel={t('Continue')}
      onConfirm={() => request?.confirm()}
      onClose={onClose}
    />
  )
}
