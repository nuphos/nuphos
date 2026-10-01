import { Clipboard } from 'lucide-react'
import { useState } from 'react'

import { Modal } from '../components/Modal'
import { useReportVisibleError } from '../components/VisibleErrorReporter'
import { reportFrontendError } from '../lib/frontendErrorReporter'

import type { DashboardPanel, DashboardPanelSnapshot } from './schema'

type Props = {
  open: boolean
  panel: DashboardPanel
  snapshot: DashboardPanelSnapshot
  onClose: () => void
}

function timestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}

export function ScriptErrorModal({ open, panel, snapshot, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const message = snapshot.error?.message ?? 'No error details were returned.'

  useReportVisibleError(message, 'cost_script_error_modal', open)
  const close = () => {
    setCopied(false)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Script error log"
      description={`${panel.title} · ${snapshot.error?.kind ?? 'unknown error'}`}
      width={680}
      footer={
        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(message)
                .then(() => setCopied(true))
                .catch((cause: unknown) => {
                  reportFrontendError(
                    {
                      source: 'clipboard',
                      phase: 'cost_script_error_log',
                      message: 'Copy failed.',
                    },
                    cause,
                  )
                })
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zGray-800 px-3 text-[12.5px] text-secondary hover:bg-zGray-800 hover:text-main"
          >
            <Clipboard className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy log'}
          </button>
          <button
            type="button"
            onClick={close}
            className="h-8 rounded-md bg-zViolet-500 px-3 text-[12.5px] font-medium text-white hover:bg-zViolet-400"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
          <dt className="text-tertiary">Snapshot</dt>
          <dd className="font-mono text-secondary">{snapshot.id}</dd>
          <dt className="text-tertiary">Script version</dt>
          <dd className="text-secondary">v{String(snapshot.scriptVersion)}</dd>
          <dt className="text-tertiary">Started</dt>
          <dd className="text-secondary">
            {timestamp(snapshot.executedAt ?? snapshot.requestedAt)}
          </dd>
          <dt className="text-tertiary">Finished</dt>
          <dd className="text-secondary">{timestamp(snapshot.finishedAt)}</dd>
          <dt className="text-tertiary">Duration</dt>
          <dd className="text-secondary">
            {snapshot.durationMs == null ? '—' : `${String(snapshot.durationMs)} ms`}
          </dd>
        </dl>
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-tertiary">
            Error
          </div>
          <pre
            className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zGray-800 bg-zGray-950 p-3 font-mono text-[12px] leading-5 text-error scrollbar-thin"
            data-ph-mask
          >
            {message}
          </pre>
        </div>
      </div>
    </Modal>
  )
}
