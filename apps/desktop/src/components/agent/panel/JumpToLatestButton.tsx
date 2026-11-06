import clsx from 'clsx'
import { ArrowDownToLine } from 'lucide-react'

import { t } from '../../../i18n'

/** Floats over the transcript bottom while the reader is up in history; names how
 *  many messages arrived since they left the bottom. */
export function JumpToLatestButton({ unseen, onClick }: { unseen: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'absolute bottom-3 left-1/2 z-20 flex h-9 -translate-x-1/2 items-center justify-center gap-1.5 rounded-full border border-line-control/80 bg-elevated/90 text-secondary shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-[transform,color,border-color,background-color] hover:-translate-x-1/2 hover:-translate-y-0.5 hover:border-action-primary/60 hover:bg-state-hover hover:text-main',
        unseen > 0 ? 'px-3.5 text-[13px] font-medium text-main' : 'w-9',
      )}
      title={t('Jump to latest')}
      aria-label={unseen > 0 ? undefined : t('Jump to latest')}
    >
      <ArrowDownToLine className="h-4 w-4" strokeWidth={1.8} />
      {unseen > 0 && (
        <span>
          {unseen === 1
            ? t('1 new message')
            : t('{n} new messages', { n: unseen.toLocaleString() })}
        </span>
      )}
    </button>
  )
}
