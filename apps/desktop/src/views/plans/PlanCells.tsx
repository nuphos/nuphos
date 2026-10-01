import { Link2, ShieldCheck, X } from 'lucide-react'

import { PermissionGrantCard } from '../../components/agent/PermissionGrantCard'

import { stepProgress } from './planProgress'

import type { Plan } from '../../api'

// Detail panel for a permission-grant request. Wraps the same review card used
// in the chat transcript with a header (title + copy-link + close), so an admin
// can approve it straight from the Plans library.
export function PermissionRequestDetail({
  proposalId,
  teamId,
  canApprove,
  onCopyLink,
  onClose,
}: {
  proposalId: string
  teamId: string
  canApprove: boolean
  onCopyLink: () => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zGray-800/60 flex-shrink-0">
        <ShieldCheck className="h-4 w-4 text-zViolet-accent flex-shrink-0" strokeWidth={1.8} />
        <div className="text-[13px] text-main font-medium">Permission request</div>
        <button
          type="button"
          onClick={onCopyLink}
          title="Copy link to share with an administrator"
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-tertiary hover:bg-zGray-800/60 hover:text-secondary"
        >
          <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          Copy link
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          className="inline-flex items-center rounded-md p-1 text-tertiary hover:bg-zGray-800/60 hover:text-secondary"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <PermissionGrantCard proposalId={proposalId} teamId={teamId} canApprove={canApprove} />
      </div>
    </div>
  )
}

export function ProgressCell({ plan }: { plan: Plan }) {
  const { done, failed, total } = stepProgress(plan)

  if (total === 0) return <span className="text-tertiary text-[12px]">—</span>

  return (
    <span className="text-secondary text-[12px] font-mono">
      {done}/{total} steps
      {failed > 0 && <span className="text-error"> · {failed} failed</span>}
    </span>
  )
}
