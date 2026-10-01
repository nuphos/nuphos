import { useEffect, useRef, useState } from 'react'

import type { Plan, PlanLifecycleStatus } from '../../../api'

export type Decision =
  | 'pending'
  | 'approving'
  | 'approved'
  | 'approval-recorded'
  | 'changes-requested'
  | 'rejected'
  | 'chatting'

type UsePlanDecisionArgs = {
  status?: PlanLifecycleStatus
  updatedAt?: string
  onApprove?: () => Promise<Plan | void> | Plan | void
  onReject?: (reason: string, mode: 'revise' | 'delete') => void
}

export function usePlanDecision({ status, updatedAt, onApprove, onReject }: UsePlanDecisionArgs) {
  const [decision, setDecision] = useState<Decision>('pending')
  // Approve is the primary action; Request changes / Reject live in its caret
  // menu. Choosing "Request changes" reveals (animated) the reason box below.
  const [changeRequest, setChangeRequest] = useState('')
  const [changesOpen, setChangesOpen] = useState(false)
  const changeRequestRef = useRef<HTMLTextAreaElement>(null)
  // True while an IME (e.g. Pinyin) is composing — Enter then selects a
  // candidate and must NOT submit the change request.
  const imeComposingRef = useRef(false)
  // The plan's updatedAt at the moment we requested changes. When the agent
  // revises in place (same id, status stays `proposed`, updatedAt advances) the
  // card mustn't stay stuck on "Changes requested" — bring the actions back.
  const reviseBaselineRef = useRef<string | null>(null)
  const approvalBaselineRef = useRef<string | null>(null)

  // Focus the reason box once it has revealed. preventScroll avoids the browser
  // scrolling the just-mounted (still-collapsing) textarea into view, which
  // fights the height animation and makes it stutter; the rAF lets the open
  // animation start first.
  useEffect(() => {
    if (!changesOpen) return
    const raf = requestAnimationFrame(() =>
      changeRequestRef.current?.focus({ preventScroll: true }),
    )

    return () => cancelAnimationFrame(raf)
  }, [changesOpen])
  // After a revision lands (updatedAt moves past the version we asked to
  // change), reset to `pending` so Approve / Reject reappear on the revised plan.
  useEffect(() => {
    if (
      decision === 'changes-requested' &&
      status === 'proposed' &&
      updatedAt &&
      updatedAt !== reviseBaselineRef.current
    ) {
      setDecision('pending')
    }
  }, [updatedAt, decision, status])
  // The old UI treated one click as final approval. With a team quorum the
  // same click may only record one vote, so wait for the refreshed server row
  // before deciding whether the Agent may proceed.
  useEffect(() => {
    if (decision !== 'approved') return
    if (status === 'approved') return
    if (
      status === 'proposed' &&
      updatedAt &&
      approvalBaselineRef.current &&
      updatedAt !== approvalBaselineRef.current
    ) {
      setDecision('approval-recorded')
    }
  }, [decision, status, updatedAt])
  if (status === 'approved' && decision === 'approval-recorded') {
    setDecision('approved')
  }

  async function approve() {
    approvalBaselineRef.current = updatedAt ?? null
    setDecision('approving')
    try {
      const next = await onApprove?.()

      if (next?.status === 'proposed') {
        setDecision('approval-recorded')
      } else {
        setDecision('approved')
      }
    } catch {
      setDecision('pending')
    }
  }
  function requestChanges() {
    const reason = changeRequest.trim()

    if (!reason) return
    // Remember the version we're asking to change so the reset effect can tell
    // when the agent's revision actually lands.
    reviseBaselineRef.current = updatedAt ?? null
    setChangesOpen(false)
    // Drop the draft once sent so it can't leak into a later Reject.
    setChangeRequest('')
    setDecision('changes-requested')
    onReject?.(reason, 'revise')
  }
  function reject() {
    // A hard reject is a direct discard — it carries no reason and must never
    // forward a leftover Request-changes draft.
    setDecision('rejected')
    onReject?.('', 'delete')
  }

  return {
    decision,
    changeRequest,
    setChangeRequest,
    changesOpen,
    setChangesOpen,
    changeRequestRef,
    imeComposingRef,
    approve,
    requestChanges,
    reject,
  }
}

export type PlanDecisionState = ReturnType<typeof usePlanDecision>
