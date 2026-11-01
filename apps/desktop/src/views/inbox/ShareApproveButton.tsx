import { ChevronDown } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { t } from '../../i18n'

import type { ShareTrustDuration } from '../../api/device-types'

/** Approves one request, or approves it and trusts the teammate on this computer for a while. */
export function ShareApproveButton({
  disabled,
  onApprove,
}: {
  disabled: boolean
  onApprove: (trust?: ShareTrustDuration) => void
}) {
  return (
    <span className="inline-flex">
      <Button size="sm" disabled={disabled} className="rounded-r-none" onClick={() => onApprove()}>
        {t('Approve')}
      </Button>
      <Menu>
        <MenuTrigger
          disabled={disabled}
          aria-label={t('More ways to approve')}
          title={t('More ways to approve')}
          render={<Button size="sm" className="rounded-l-none border-l border-black/15 px-1.5" />}
        >
          <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onClick={() => onApprove('8h')}>{t('Approve and trust for 8 hours')}</MenuItem>
          <MenuItem onClick={() => onApprove('always')}>{t('Approve and always trust')}</MenuItem>
        </MenuContent>
      </Menu>
    </span>
  )
}
