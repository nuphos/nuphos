import { CheckCircle2, Clock3, MessageSquare, Play, ShieldCheck } from 'lucide-react'

import { useReportVisibleError } from '../../components/VisibleErrorReporter'

import { ActionButton, Label, Metric, StatusBadge, TextBlock } from './ChangesCommon'
import { previewValue } from './changesStatement'
import { HighlightedJson } from './HighlightedJson'

import type { DatabaseChangeRequest } from '../../types'

export function ChangeDetail({
  change,
  currentUserId,
  memberName,
  busyAction,
  onDecide,
  onExecute,
  onOpenPlanInChat,
}: {
  change: DatabaseChangeRequest
  currentUserId: string
  memberName: (id: string) => string
  busyAction: string | null
  onDecide: (action: 'submit' | 'approve' | 'reject' | 'cancel') => void
  onExecute: () => void
  onOpenPlanInChat?: (planId: string) => void
}) {
  const loading = busyAction !== null

  useReportVisibleError(change.executionErrorMessage, 'database_change_execution_error')

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-medium text-main">{change.title}</h3>
            <StatusBadge status={change.status} />
          </div>
          <div className="mt-1 text-[11px] text-tertiary">
            Requested by {memberName(change.requesterUserId)} · {change.kind.toUpperCase()} ·{' '}
            {change.planId
              ? `${change.proposalSource === 'agent' ? 'Agent ' : ''}Plan #${change.planId} · `
              : ''}
            digest {change.statementDigest.slice(0, 12)}…
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {change.planId && onOpenPlanInChat && (
            <ActionButton
              disabled={loading}
              onClick={() => onOpenPlanInChat(change.planId!)}
              label={
                change.status === 'approved' && change.proposalSource === 'agent'
                  ? 'Continue Agent execution'
                  : 'Open Plan in Agent'
              }
              icon={<MessageSquare className="h-3 w-3" />}
            />
          )}
          {change.canEdit && (
            <ActionButton
              disabled={loading}
              onClick={() => onDecide('submit')}
              label="Submit for approval"
            />
          )}
          {change.canApprove && (
            <ActionButton
              disabled={loading}
              onClick={() => onDecide('approve')}
              label="Approve"
              tone="success"
            />
          )}
          {change.canReject && (
            <ActionButton
              disabled={loading}
              onClick={() => onDecide('reject')}
              label="Reject"
              tone="error"
            />
          )}
          {change.canCancel && (
            <ActionButton disabled={loading} onClick={() => onDecide('cancel')} label="Cancel" />
          )}
          {change.canExecute && (
            <ActionButton
              disabled={loading}
              onClick={onExecute}
              label="Execute"
              tone="warning"
              icon={<Play className="h-3 w-3" />}
            />
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Metric
          label="Approval"
          value={`${String(change.currentApprovals)} / ${String(change.requiredApprovals)}`}
        />
        <Metric
          label="Authorized executors"
          value={String(change.authorizedExecutorUserIds.length)}
        />
        <Metric
          label="You can execute"
          value={
            change.authorizedExecutorUserIds.includes(currentUserId) ? 'Yes, after approval' : 'No'
          }
        />
      </div>
      <section>
        <Label>Approved statement preview</Label>
        <div className="max-h-72 overflow-auto rounded-lg border border-zGray-800 bg-[#011627] p-3">
          <HighlightedJson value={previewValue(change)} />
        </div>
        {change.statementRedactedFields.length > 0 && (
          <div className="mt-1 text-[10px] text-warning">
            Sensitive paths redacted: {change.statementRedactedFields.join(', ')}
          </div>
        )}
      </section>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <TextBlock title="Purpose" text={change.description} />
        <TextBlock title="Risk" text={change.risk} />
        <TextBlock title="Rollback" text={change.rollbackPlan} />
      </div>
      <section>
        <Label>Authorized executors</Label>
        <div className="flex flex-wrap gap-1.5">
          {change.authorizedExecutorUserIds.map((id) => (
            <span
              key={id}
              className="rounded-full border border-zGray-800 px-2 py-1 text-[10.5px] text-secondary"
            >
              {memberName(id)}
              {id === change.requesterUserId ? ' · requester' : ''}
            </span>
          ))}
        </div>
      </section>
      <section>
        <Label>Approvals</Label>
        {change.approvals.length ? (
          <div className="space-y-1.5">
            {change.approvals.map((approval) => (
              <div
                key={`${approval.userId}:${approval.createdAt}`}
                className="flex items-center gap-2 rounded-md border border-zGray-800 px-2.5 py-2 text-[10.5px]"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                <span className="text-secondary">{memberName(approval.userId)}</span>
                <span className="text-tertiary">
                  {new Date(approval.createdAt).toLocaleString()}
                </span>
                {approval.comment && (
                  <span className="ml-auto text-tertiary">{approval.comment}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-tertiary">Waiting for another team member.</div>
        )}
      </section>
      {change.executionResult && (
        <section>
          <Label>Execution result</Label>
          <div className="rounded-lg border border-success/25 bg-success/5 p-3">
            <HighlightedJson value={change.executionResult} />
          </div>
        </section>
      )}
      {change.executionErrorMessage && (
        <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-[11px] text-error">
          <div className="font-medium">Execution failed · {change.executionErrorCategory}</div>
          <div className="mt-1">{change.executionErrorMessage}</div>
        </div>
      )}
      <section>
        <Label>Timeline</Label>
        <div className="space-y-1.5">
          {[...change.events].reverse().map((event, index) => (
            <div key={`${event.at}:${String(index)}`} className="flex gap-2 text-[10.5px]">
              <Clock3 className="mt-0.5 h-3 w-3 shrink-0 text-tertiary" />
              <span className="w-36 shrink-0 text-tertiary">
                {new Date(event.at).toLocaleString()}
              </span>
              <span className="text-secondary">{event.type.replaceAll('_', ' ')}</span>
              <span className="text-tertiary">by {memberName(event.actorUserId)}</span>
              {event.comment && <span className="ml-auto text-tertiary">{event.comment}</span>}
            </div>
          ))}
        </div>
      </section>
      <div className="flex gap-2 rounded-md border border-zGray-800 bg-zGray-900/50 p-2.5 text-[10.5px] leading-4 text-tertiary">
        <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
        Approval never executes the request or grants execution rights. Only the listed executors
        can explicitly claim the immutable approved digest.
      </div>
    </div>
  )
}
