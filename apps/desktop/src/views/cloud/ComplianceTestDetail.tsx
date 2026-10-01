import { MessageSquare, X } from 'lucide-react'

import { Age } from '../../components/Age'
import { StatusBadge } from '../../components/StatusBadge'

import type { ComplianceRow } from './compliance-helpers'

export function ComplianceTestDetail({
  row,
  provider,
  onOpenInChat,
  onClose,
}: {
  row: ComplianceRow
  provider: 'secureframe' | 'vanta'
  onOpenInChat: () => void
  onClose: () => void
}) {
  const providerLabel = provider === 'vanta' ? 'Vanta' : 'Secureframe'

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-start gap-2 px-4 py-3 border-b border-zGray-800/60">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-tertiary">
            {providerLabel} test
          </div>
          <div className="mt-0.5 text-[14px] font-medium text-main break-words">{row.name}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-tertiary hover:text-main hover:bg-[var(--sidebar-overlay-hover)]"
          title="Close"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={row.status} />
          {row.category && <span className="text-tertiary">· {row.category}</span>}
          {row.lastRun && (
            <span className="text-tertiary">
              · last run <Age value={row.lastRun} />
            </span>
          )}
        </div>
        {row.reason && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-tertiary mb-1">
              Why it is failing
            </div>
            <div className="text-secondary whitespace-pre-wrap break-words">{row.reason}</div>
          </div>
        )}
        {row.remediation && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-tertiary mb-1">
              Remediation
            </div>
            <div className="text-secondary whitespace-pre-wrap break-words">{row.remediation}</div>
          </div>
        )}
        {!row.reason && !row.remediation && (
          <div className="text-tertiary">
            No failure details reported by {providerLabel} for this test.
          </div>
        )}
      </div>
      <div className="flex-shrink-0 border-t border-zGray-800/60 p-3">
        <button
          type="button"
          onClick={onOpenInChat}
          className="h-8 w-full gap-1.5 text-[13px] rounded-md bg-zViolet-500 text-white font-medium inline-flex items-center justify-center hover:bg-zViolet-400"
        >
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
          Open in chat
        </button>
      </div>
    </div>
  )
}
