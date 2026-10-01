import { ShieldCheck, Loader2, AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { useReportVisibleError } from '../VisibleErrorReporter'

import type { PermissionGrantProposalView } from '../../types'

function statusChip(status: PermissionGrantProposalView['status']): {
  label: string
  className: string
} {
  switch (status) {
    case 'proposed':
      return { label: 'Retired', className: 'bg-zGray-800 text-tertiary' }
    case 'executing':
      return { label: 'Applying…', className: 'bg-zViolet-500/15 text-zViolet-accent' }
    case 'executed':
      return { label: 'Applied', className: 'bg-success/15 text-success' }
    case 'rejected':
      return { label: 'Rejected', className: 'bg-zGray-800 text-tertiary' }
    case 'failed':
      return { label: 'Failed', className: 'bg-error/15 text-error' }
  }
}

/** Read-only record of a historical cloud-permission proposal. */
export function PermissionGrantCard({
  proposalId,
  teamId,
}: {
  proposalId: string
  teamId?: string
  /** The viewer is a team administrator on an idle tab — Approve/Reject enabled. */
  canApprove: boolean
  /** The tool call id of the propose_permission_grant part, when rendered inline
   *  in a paused chat turn — lets the decision rewrite its result and resume. */
  toolCallId?: string
}) {
  const [proposal, setProposal] = useState<PermissionGrantProposalView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const reqRef = useRef(0)

  useReportVisibleError(loadError, 'permission_proposal_load_error')
  useReportVisibleError(
    proposal?.status === 'failed' ? proposal.executionError : null,
    'permission_proposal_execution_error',
  )

  const load = useCallback(() => {
    if (!teamId) return
    const req = ++reqRef.current

    api
      .atlasGetPermissionGrantProposal(teamId, proposalId)
      .then((p) => {
        if (req === reqRef.current) setProposal(p)
      })
      .catch((e: unknown) => {
        if (req === reqRef.current) setLoadError(String(e instanceof Error ? e.message : e))
      })
  }, [teamId, proposalId])

  useEffect(() => {
    load()
  }, [load])

  if (loadError && !proposal) {
    return (
      <div className="rounded-lg border border-zGray-800 bg-zGray-875 p-3 text-[12px] text-tertiary">
        Couldn&apos;t load the permission proposal: {loadError}
      </div>
    )
  }
  if (!proposal) {
    return (
      <div className="rounded-lg border border-zGray-800 bg-zGray-875 p-3 text-[12px] text-tertiary inline-flex items-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading permission proposal…
      </div>
    )
  }

  const chip = statusChip(proposal.status)

  return (
    <div className="rounded-lg border border-zViolet-500/30 bg-zViolet-500/[0.06] overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-zGray-800/60">
        <ShieldCheck className="h-4 w-4 text-zViolet-accent flex-shrink-0" strokeWidth={1.8} />
        <div className="text-[13px] text-main font-medium">
          {proposal.action === 'revoke'
            ? 'Permission removal proposed'
            : 'Permission change proposed'}
        </div>
        <span
          className={`ml-auto text-[10.5px] font-medium px-1.5 py-0.5 rounded ${chip.className}`}
        >
          {chip.label}
        </span>
      </div>

      <div className="px-3.5 py-3 space-y-2.5">
        <div className="space-y-1">
          {proposal.decisions.map((d, i) => (
            <div key={`${String(i)}-${d.label}`} className="flex gap-2 text-[12px]">
              <span className="text-tertiary w-32 flex-shrink-0">{d.label}</span>
              <span className="text-main font-mono text-[11.5px] break-all">{d.value}</span>
            </div>
          ))}
        </div>

        <div className="text-[11.5px] text-secondary leading-relaxed border-t border-zGray-800/60 pt-2">
          <span className="text-tertiary">Why: </span>
          {proposal.reason}
        </div>

        {proposal.status === 'failed' && proposal.executionError && (
          <div className="flex items-start gap-1.5 text-[11.5px] text-error leading-relaxed">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>{proposal.executionError}</span>
          </div>
        )}

        {proposal.status === 'proposed' && (
          <p className="text-[11.5px] text-tertiary">
            This proposal can no longer be applied. Update permissions in your cloud console, then
            retry the task.
          </p>
        )}
      </div>
    </div>
  )
}
