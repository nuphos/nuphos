import { ShieldCheck } from 'lucide-react'
import { useContext, useRef } from 'react'

import { comboText } from '../../../lib/platform'
import { Button } from '../../ui/button'

import { AuthorizationActionContext } from './parts'
import { useDecisionKeys } from './useDecisionKeys'

export function AuthorizationApprovalActions({
  toolCallId,
  reason,
}: {
  toolCallId: string
  reason?: string
}) {
  const ctx = useContext(AuthorizationActionContext)
  const cardRef = useRef<HTMLDivElement | null>(null)
  // Read-only sessions never expose approve/deny. Otherwise only the latest
  // unresolved authorization shows buttons; a superseded earlier block renders
  // nothing (the newer attempt's card owns the prompt).
  const live = Boolean(ctx && !ctx.readOnly && ctx.activeToolCallId === toolCallId)
  const decide = (decision: 'once' | 'deny') => ctx?.decide(toolCallId, decision)
  const act = useDecisionKeys(cardRef, live, (key) => {
    if (key.kind === 'option') return false
    decide(key.kind === 'approve' ? 'once' : 'deny')

    return true
  })

  if (!live) return null

  return (
    <div
      ref={cardRef}
      data-decision-card=""
      className="mt-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5"
    >
      <div className="flex items-start gap-1.5 text-[12px] text-main">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" strokeWidth={2} />
        <span>Authorization required{reason ? ` — ${reason}` : ''}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          type="button"
          title={`Approve once (${comboText('mod+enter')})`}
          onClick={() => act(() => decide('once'))}
        >
          Approve once
        </Button>
        <button
          type="button"
          title={`Deny (${comboText('mod+backspace')})`}
          onClick={() => act(() => decide('deny'))}
          className="inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium text-tertiary transition-colors hover:text-red-400"
        >
          Deny
        </button>
      </div>
    </div>
  )
}
