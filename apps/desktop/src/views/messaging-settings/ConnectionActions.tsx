import clsx from 'clsx'
import { ExternalLink as ExternalLinkIcon, Trash2 as Trash2Icon } from 'lucide-react'

import { UiIcon } from '../../components/ui/ui-icon'
import { t } from '../../i18n'

const buttonClasses =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-line-control px-2.5 text-[12.5px] font-medium text-secondary transition-colors disabled:cursor-not-allowed disabled:opacity-50'

/** Reinstall / reconfigure + disconnect pair for an installed messaging app. */
export function ConnectionActions({
  primaryLabel,
  primaryDisabled = false,
  primaryTitle,
  onPrimary,
  onDisconnect,
  className,
}: {
  primaryLabel: string
  primaryDisabled?: boolean
  primaryTitle?: string
  onPrimary: () => void
  onDisconnect: () => void
  className?: string
}) {
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        title={primaryTitle}
        className={clsx(buttonClasses, 'hover:border-line-control hover:text-main')}
      >
        <UiIcon size={16} icon={ExternalLinkIcon} className="h-4 w-4" />
        {primaryLabel}
      </button>
      <button
        type="button"
        onClick={onDisconnect}
        className={clsx(buttonClasses, 'hover:border-error/50 hover:text-error')}
      >
        <UiIcon size={16} icon={Trash2Icon} className="h-4 w-4" />
        {t('Disconnect')}
      </button>
    </div>
  )
}
