import { Collapsible } from '@base-ui/react/collapsible'
import { ChevronRight, Clipboard } from 'lucide-react'
import { useState } from 'react'

import { parseAtlasError } from '../../api'
import { useReportVisibleError } from '../../components/VisibleErrorReporter'
import { reportFrontendError } from '../../lib/frontendErrorReporter'
import { queryErrorText } from '../errorText'

export function QueryError({ message }: { message: string }) {
  const { summary, detail } = queryErrorText(parseAtlasError(message).message)
  const [copied, setCopied] = useState(false)

  useReportVisibleError(message, 'grafana_query_error')

  return (
    <div className="min-w-0 text-[12px] leading-5">
      <div className="break-words text-error">{summary}</div>
      {detail && (
        <Collapsible.Root className="mt-1.5">
          <Collapsible.Trigger className="group inline-flex items-center gap-1 text-[10.5px] uppercase tracking-wider text-tertiary hover:text-secondary">
            <ChevronRight
              className="h-2.5 w-2.5 transition-transform group-data-[panel-open]:rotate-90"
              strokeWidth={2}
            />
            Details
          </Collapsible.Trigger>
          <Collapsible.Panel className="mt-1">
            <pre
              className="max-h-40 overflow-auto whitespace-pre-wrap break-all border-l border-zGray-800 pl-2 font-mono text-[11px] leading-4 text-tertiary scrollbar-thin"
              data-ph-mask
            >
              {detail}
            </pre>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(detail)
                  .then(() => setCopied(true))
                  .catch((cause: unknown) => {
                    reportFrontendError(
                      {
                        source: 'clipboard',
                        phase: 'grafana_error_details',
                        message: 'Copy failed.',
                      },
                      cause,
                    )
                  })
              }}
              className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-tertiary hover:bg-zGray-800 hover:text-main"
            >
              <Clipboard className="h-3 w-3" strokeWidth={1.8} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </div>
  )
}
