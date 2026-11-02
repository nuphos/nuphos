import { X } from 'lucide-react'

import { Kbd } from '../../components/ui/kbd'
import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'

/**
 * The split pane's own close button, at the end of its header where a tab's
 * close would be. Closing a pane only changes the layout (its chats' docks move
 * to the remaining pane), so it needs no confirmation.
 */
export function PaneCloseButton({ onClosePane }: { onClosePane: () => void }) {
  return (
    <Tooltip
      side="bottom"
      content={
        <span className="flex items-center gap-2">
          {t('Close pane')}
          <Kbd combo="mod+w" />
        </span>
      }
    >
      <button
        type="button"
        aria-label={t('Close pane')}
        onClick={onClosePane}
        className="titlebar-no-drag ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main motion-reduce:transition-none"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      </button>
    </Tooltip>
  )
}
