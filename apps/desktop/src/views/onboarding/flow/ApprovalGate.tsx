import clsx from 'clsx'
import { Check, Loader2, ScrollText, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ApprovalDecision } from './value-prop-data'

// A real control proving the approval model: a read runs without asking (it
// needs no permission — that's part of the claim); a write sits held until
// the user explicitly approves or denies it. No timers, no loop — it renders
// one state and waits. This is the product's signature interaction, not a
// picture of it, so (unlike its sibling demos below) it is NOT aria-hidden
// and its controls carry real accessible labels.
export function ApprovalGate({
  decision,
  reduce,
  settled,
  onReachedRequest,
}: {
  /** null while the request is still pending on the user's answer, which is
   *  given below the card — where the agent asks, in the conversation — not
   *  on the request panel itself. */
  decision: ApprovalDecision | null
  reduce: boolean
  /** Render the whole thing already at the request (revisits, dev jumps). */
  settled: boolean
  /** Fires once the agent has hit the thing it can't do alone — the cue to
   *  offer Approve/Reject below. */
  onReachedRequest: () => void
}) {
  const resolved = decision !== null
  const approved = decision === 'approved'
  const denied = decision === 'denied'

  // A one-shot lead-in, not a loop and never a decision: the read runs on its
  // own, finishes, and only then does the write appear — held. Watching it get
  // that far is what makes the ask land as something the agent ran into rather
  // than a control that was always sitting there.
  const [atRequest, setAtRequest] = useState(settled || resolved)

  useEffect(() => {
    if (settled || resolved) {
      onReachedRequest()

      return
    }
    const timers = [
      window.setTimeout(() => setAtRequest(true), reduce ? 0 : 1200),
      window.setTimeout(() => onReachedRequest(), reduce ? 0 : 1700),
    ]

    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [settled, resolved, reduce, onReachedRequest])

  return (
    <div className="space-y-2.5 rounded-xl border border-zGray-800/70 bg-zGray-950/40 px-3.5 py-3">
      {/* Read action — runs without asking. */}
      <div className="flex items-center gap-2 text-[12.5px]">
        {atRequest ? (
          <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" strokeWidth={2.4} />
        ) : (
          <Loader2
            className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-tertiary"
            strokeWidth={2}
          />
        )}
        {atRequest ? (
          <span className="text-secondary">Read instance metrics</span>
        ) : (
          <span className="codex-shimmer-text t-text-swap">Reading instance metrics</span>
        )}
        <span
          className={clsx(
            'ml-auto flex-shrink-0 rounded-full border border-zGray-800 px-2 py-0.5 text-[10.5px] text-tertiary transition-opacity duration-300',
            atRequest ? 'opacity-100' : 'opacity-0',
          )}
        >
          read-only
        </span>
      </div>

      {/* Write action — appears once the read is done, then held until the
          user decides. */}
      <div
        className={clsx('transition-opacity duration-300', atRequest ? 'opacity-100' : 'opacity-0')}
      >
        <div className="flex items-center gap-2 text-[12.5px]">
          {approved ? (
            <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" strokeWidth={2.4} />
          ) : denied ? (
            <X className="h-3.5 w-3.5 flex-shrink-0 text-zGray-400" strokeWidth={2.4} />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" strokeWidth={2} />
          )}
          <span className="text-secondary">Restart api-server</span>
          <span
            className={clsx(
              'ml-auto flex-shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] transition-colors duration-300',
              approved
                ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                : denied
                  ? 'border-zGray-700 bg-zGray-800/60 text-tertiary'
                  : 'border-amber-400/40 bg-amber-400/10 text-amber-300',
            )}
          >
            {approved
              ? 'approved by you'
              : denied
                ? 'denied — nothing ran'
                : 'waiting for your approval'}
          </span>
        </div>
        {/* WHO is asking and UNDER WHAT CONDITIONS — the half of the trust
            claim that a bare approval prompt leaves out. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[22px] font-mono text-[10.5px] text-tertiary">
          {['role: sre-agent', 'env: staging', 'change window'].map((meta) => (
            <span key={meta} className="rounded border border-zGray-800 px-1.5 py-0.5">
              {meta}
            </span>
          ))}
        </div>
      </div>

      {/* Auditability — approved or denied, the decision leaves a record. A
          refusal is auditable too; that's the stronger half of the claim. */}
      <div
        className={clsx(
          'flex items-center gap-2 border-t border-zGray-800/70 pt-2.5 text-[11.5px] text-tertiary transition-opacity duration-300',
          resolved ? 'opacity-100' : 'opacity-0',
        )}
      >
        <ScrollText className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
        <span>Audit log</span>
        <span className="ml-auto font-mono text-[10.5px]">
          sre-agent · restart api-server · {denied ? 'denied' : 'executed'}
        </span>
      </div>
    </div>
  )
}
