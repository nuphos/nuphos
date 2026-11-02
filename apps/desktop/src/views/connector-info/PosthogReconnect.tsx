import { useState } from 'react'

import { CloudLogo } from '../../components/CloudLogo'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'
import { BindPosthogDialog } from '../BindPosthogDialog'

import type { PosthogDialogMode } from '../BindPosthogDialog'

export function PosthogReconnectPrompt({
  teamId,
  integration,
  onReconnected,
}: {
  teamId: string
  integration: PosthogDialogMode['integration']
  onReconnected: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-zGray-800 px-4 py-4 text-center">
      <div className="text-[12.5px] text-secondary">
        {t('{name} authorization expired or was revoked. Reconnect {name} to keep using it.', {
          name: 'PostHog',
        })}
      </div>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <CloudLogo provider="posthog" size={14} />
        {t('Reconnect {name}', { name: 'PostHog' })}
      </Button>
      {open && (
        <BindPosthogDialog
          teamId={teamId}
          mode={{ kind: 'reconnect', integration }}
          onClose={() => setOpen(false)}
          onBound={() => {
            setOpen(false)
            onReconnected()
          }}
        />
      )}
    </div>
  )
}
