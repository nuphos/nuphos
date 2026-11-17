import { Monitor } from 'lucide-react'

import { api } from '../../api'
import { openSessionDesktop } from '../../app/workspace/openSessionDesktop'
import { t } from '../../i18n'
import { IconButton } from '../ui/icon-button'
import { toast } from '../ui/toast'

export function BotDesktopButton({ teamId, botId }: { teamId: string; botId: string }) {
  return (
    <IconButton
      label={t('Desktop')}
      icon={<Monitor />}
      onClick={() => {
        openSessionDesktop(teamId, botId, api.openSessionDesktop).catch((error: unknown) =>
          toast.apiError(t('Could not open the desktop'), error),
        )
      }}
    />
  )
}
