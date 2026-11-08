import { useState } from 'react'

import { t } from '../../i18n'
import { AppAlertDialog } from '../ui/alert-dialog'

/** A Bot's Task row archives the whole Bot, so it asks first. */
export function useArchiveBotConfirm(archiveChat: (sessionId: string) => Promise<void>) {
  const [botId, setBotId] = useState<string | null>(null)

  return {
    confirm: setBotId,
    dialog: (
      <AppAlertDialog
        open={botId !== null}
        title={t('This is a Bot. Archive the Bot?')}
        description={t('Its chat is archived with it. Unarchive either one to bring both back.')}
        confirmLabel={t('Archive Bot')}
        onConfirm={() => {
          if (botId) void archiveChat(botId)
        }}
        onClose={() => setBotId(null)}
      />
    ),
  }
}
