import { faArrowUpRightFromSquare, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'

const buttonClasses =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-zGray-800 px-2.5 text-[12.5px] font-medium text-secondary transition-colors disabled:cursor-not-allowed disabled:opacity-50'

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
        className={clsx(buttonClasses, 'hover:border-zGray-700 hover:text-main')}
      >
        <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="h-3 w-3" />
        {primaryLabel}
      </button>
      <button
        type="button"
        onClick={onDisconnect}
        className={clsx(buttonClasses, 'hover:border-error/50 hover:text-error')}
      >
        <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
        Disconnect
      </button>
    </div>
  )
}
