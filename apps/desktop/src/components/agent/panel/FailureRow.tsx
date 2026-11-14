import { CircleAlert } from 'lucide-react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { CopyMessageButton } from './messageActions'

import type { ReactNode } from 'react'

/**
 * A turn that could not run: what happened and why, then the fix. A Bot chat's
 * "couldn't reply" line and a conversation's failed turn draw it the same way.
 */
export function FailureRow({
  children,
  fix,
  onSwitchAgent,
  onRetry,
  retrying = false,
  copyText,
}: {
  children: ReactNode
  /** The way to repair the cause, such as signing the agent in again; it leads the actions. */
  fix?: ReactNode
  /** Opens the agent list: only for the agent's owner, when the agent itself was the cause. */
  onSwitchAgent?: () => void
  onRetry?: () => void
  retrying?: boolean
  copyText?: string
}) {
  return (
    <div className="flex justify-center py-1">
      <div className="flex max-w-[560px] items-start gap-2 rounded-xl border border-line-control/60 bg-main px-3 py-2 text-[12.5px] text-secondary">
        <CircleAlert className="mt-[2px] h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={2.5} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <span>{children}</span>
          {(fix || onSwitchAgent || onRetry || copyText) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {fix}
              {onSwitchAgent && (
                <Button size="sm" variant="secondary" onClick={onSwitchAgent}>
                  {t('Switch runtime')}
                </Button>
              )}
              {onRetry && (
                <Button size="sm" variant="ghost" disabled={retrying} onClick={onRetry}>
                  {t('Retry')}
                </Button>
              )}
              {copyText && <CopyMessageButton text={copyText} label={t('Copy')} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
