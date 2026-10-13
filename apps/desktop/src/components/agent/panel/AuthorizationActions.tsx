import { ShieldCheck } from 'lucide-react'
import { useContext } from 'react'

import { AuthorizationActionContext } from './parts'

export function AuthorizationApprovalActions({
  toolCallId,
  reason,
}: {
  toolCallId: string
  reason?: string
}) {
  const ctx = useContext(AuthorizationActionContext)

  // Read-only sessions never expose approve/deny. Otherwise only the latest
  // unresolved authorization shows buttons; a superseded earlier block renders
  // nothing (the newer attempt's card owns the prompt).
  if (!ctx || ctx.readOnly || ctx.activeToolCallId !== toolCallId) return null
  const decide = ctx.decide

  return (
    <div className="mt-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5">
      <div className="flex items-start gap-1.5 text-[12px] text-main">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" strokeWidth={2} />
        <span>Authorization required{reason ? ` — ${reason}` : ''}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => decide(toolCallId, 'once')}
          className="inline-flex h-8 items-center rounded-md bg-zViolet-500 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zViolet-600"
        >
          Approve once
        </button>
        <button
          type="button"
          onClick={() => decide(toolCallId, 'deny')}
          className="inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium text-tertiary transition-colors hover:text-red-400"
        >
          Deny
        </button>
      </div>
    </div>
  )
}
