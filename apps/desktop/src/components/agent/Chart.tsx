import { PanelRight } from 'lucide-react'
import { memo } from 'react'

import { t } from '../../i18n'
import { ChartPlot } from '../ChartPlot'

import type { ChartPayload } from './chartPayload'

/** Self-contained chart card used inside Agent messages. */
export const Chart = memo(
  ({
    payload,
    onOpen,
  }: {
    payload: ChartPayload
    /** Open it in a dock tab. */ onOpen?: () => void
  }) => {
    const { title, description } = payload

    return (
      <div className="my-2 overflow-hidden rounded-lg border border-line-control bg-state-selected px-3 pt-3 pb-1.5">
        <div className="mb-1 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium text-main">{title}</div>
            {description && <div className="text-[12px] text-tertiary">{description}</div>}
          </div>
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              title={t('Open beside the chat')}
              className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-line-control px-2 text-[12px] leading-none text-secondary outline-none transition-colors duration-150 hover:bg-state-hover hover:text-main focus-visible:ring-2 focus-visible:ring-line-focus motion-reduce:transition-none"
            >
              {t('Open')}
              <PanelRight className="size-3" strokeWidth={1.75} />
            </button>
          )}
        </div>
        <ChartPlot payload={payload} />
      </div>
    )
  },
)

Chart.displayName = 'Chart'
