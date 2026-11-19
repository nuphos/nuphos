import { Copy, Download } from 'lucide-react'

import { t } from '../../../i18n'

export function LightboxFooter({
  fileName,
  index,
  count,
  onCopy,
  onDownload,
}: {
  fileName: string
  index: number
  count: number
  onCopy?: () => void
  onDownload?: () => void
}) {
  return (
    <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-3 px-16 text-[12px] text-white/80">
      <span className="min-w-0 truncate">{fileName}</span>
      {count > 1 && (
        <span className="flex-shrink-0 tabular-nums text-white/60">
          {index + 1} / {count}
        </span>
      )}
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white"
        >
          <Copy className="h-3 w-3" strokeWidth={2.2} />
          {t('Copy image')}
        </button>
      )}
      {onDownload && (
        <button
          type="button"
          onClick={onDownload}
          className="flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white"
        >
          <Download className="h-3 w-3" strokeWidth={2.2} />
          {t('Download')}
        </button>
      )}
    </div>
  )
}
