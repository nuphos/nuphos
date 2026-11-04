import { X } from 'lucide-react'

import { Kbd } from '../../components/ui/kbd'
import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'

/**
 * The split pane's own close button, at the end of its header where a tab's
 * close would be. Closing a pane only changes the layout (its chats' docks move
 * to the remaining pane), so it needs no confirmation. A rule sets it apart from
 * the panel toggles before it, so it never reads as closing the side panel.
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
        className="titlebar-no-drag relative ml-2.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors before:absolute before:-left-1.5 before:top-1.5 before:h-4 before:w-px before:bg-zGray-800 hover:bg-zGray-800/60 hover:text-main motion-reduce:transition-none"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      </button>
    </Tooltip>
  )
}
