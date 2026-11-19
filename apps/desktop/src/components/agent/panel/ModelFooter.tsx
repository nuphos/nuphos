import clsx from 'clsx'
import { Loader2, RefreshCw } from 'lucide-react'

import { t } from '../../../i18n'
import { MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from '../../ui/menu'

type FooterProps = {
  lines: string[]
  /** The line that reports a failure, announced as an alert. */
  error?: string
  onRetry?: () => void
  retrying: boolean
}

/** Connection notes at the foot of the model menu, as a labelled group, with a retry when it failed. */
export function ModelMenuFooter({ lines, error, onRetry, retrying }: FooterProps) {
  if (lines.length === 0) return null
  const Icon = retrying ? Loader2 : RefreshCw

  return (
    <>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel className="max-w-64 text-xs font-normal normal-case tracking-normal">
          {lines.map((line) => (
            <span key={line} role={line === error ? 'alert' : 'status'} className="block">
              {line}
            </span>
          ))}
        </MenuGroupLabel>
        {onRetry && (
          <MenuItem
            icon={<Icon size={13} className={clsx(retrying && 'animate-spin')} />}
            disabled={retrying}
            closeOnClick={false}
            onClick={onRetry}
          >
            {t('Retry connection')}
          </MenuItem>
        )}
      </MenuGroup>
    </>
  )
}
