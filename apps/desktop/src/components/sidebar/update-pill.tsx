import clsx from 'clsx'
import { ArrowDown } from 'lucide-react'

import { t } from '../../i18n'
import { Button } from '../ui/button'

import type { ReadyUpdate } from '../readyUpdate'

/** The ready update as a round button that opens into an "Update" pill on hover or
 * focus. The pill grows to the left over its neighbour, so the footer row never moves.
 * While a newer release downloads in its place, it shows the percent and waits. */
export function UpdatePill({ update, onUpdate }: { update: ReadyUpdate; onUpdate: () => void }) {
  const downloading = update.percent !== null
  const label = downloading
    ? t('Downloading Nuphos {version}…', { version: update.version })
    : t('Update ready — version {version}', { version: update.version })

  return (
    <span className="relative size-8 flex-shrink-0">
      <Button
        size="sm"
        data-update-pill
        onClick={onUpdate}
        disabled={downloading}
        aria-label={label}
        title={label}
        className={clsx(
          'update-notif-enter group titlebar-no-drag absolute right-0 top-0 z-10 w-max min-w-8 !gap-0 !rounded-full',
          downloading ? '!px-0' : '!px-[9px]',
        )}
      >
        {downloading ? (
          <span className="text-[11px] tabular-nums">{update.percent}%</span>
        ) : (
          <>
            <ArrowDown className="size-3.5 flex-shrink-0" strokeWidth={2.4} />
            {/* 0fr to 1fr animates to the label's own width, whatever the language. */}
            <span className="grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,opacity] duration-200 ease-out group-hover:grid-cols-[1fr] group-hover:opacity-100 group-focus-visible:grid-cols-[1fr] group-focus-visible:opacity-100 motion-reduce:transition-none">
              <span className="overflow-hidden">
                <span className="block pl-1.5 pr-0.5">{t('Update')}</span>
              </span>
            </span>
          </>
        )}
      </Button>
    </span>
  )
}
