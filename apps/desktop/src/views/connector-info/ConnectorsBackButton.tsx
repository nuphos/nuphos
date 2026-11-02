import { ArrowLeft } from 'lucide-react'

import { t } from '../../i18n'

/** Top-left "← Connectors" link back to the Connectors list. */
export function ConnectorsBackButton({ onBack }: { onBack: () => void }) {
  return (
    <div className="px-4 pt-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-secondary hover:bg-zGray-800/60 hover:text-main focus-visible:bg-zGray-800/60 focus-visible:text-main focus-visible:shadow-none focus-visible:ring-1 focus-visible:ring-zGray-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('Connectors')}
      </button>
    </div>
  )
}
