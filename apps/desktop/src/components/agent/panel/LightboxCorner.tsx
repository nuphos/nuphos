import { Dialog } from '@base-ui/react/dialog'
import { Download, X } from 'lucide-react'

import { t } from '../../../i18n'

const ROUND_BUTTON =
  'flex h-7 w-7 items-center justify-center rounded-full bg-surface-sheet text-secondary shadow-lg hover:text-main'

/** The media viewer's top-right controls: Download the shown item (when it can be saved), then close. */
export function LightboxCorner({
  index,
  onDownload,
}: {
  index: number
  onDownload?: (index: number) => void
}) {
  return (
    <div className="absolute right-4 top-4 flex items-center gap-2">
      {onDownload && (
        <button
          type="button"
          onClick={() => onDownload(index)}
          className={ROUND_BUTTON}
          aria-label={t('Download')}
          title={t('Download')}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      )}
      <Dialog.Close className={ROUND_BUTTON} aria-label={t('Close preview')}>
        <X className="h-3.5 w-3.5" strokeWidth={2.2} />
      </Dialog.Close>
    </div>
  )
}
