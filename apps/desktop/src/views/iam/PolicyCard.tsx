import clsx from 'clsx'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { formatAge } from '../../utils'

import type { AwsIamPolicy, AwsIamStatement } from '../../types'

function truncatedInlineList(items: string[], limit: number): string {
  if (items.length === 0) return '—'
  if (items.length <= limit) return items.join(', ')

  return `${items.slice(0, limit).join(', ')}, ... +${String(items.length - limit)} more`
}

export function PolicyCard({ policy }: { policy: AwsIamPolicy }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-t border-zGray-800/60 first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full py-2 flex items-center gap-2 text-left hover:bg-zGray-950"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
        )}
        <span className="text-[12.5px] text-main truncate font-medium">{policy.name}</span>
        <span
          className={clsx(
            'ml-auto text-[10.5px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded',
            policy.kind === 'inline'
              ? 'bg-zViolet-500/15 text-zViolet-accent'
              : policy.awsManaged
                ? 'bg-zGray-800 text-secondary'
                : 'bg-warning/15 text-warning',
          )}
        >
          {policy.kind === 'inline'
            ? 'Inline'
            : policy.awsManaged
              ? 'AWS managed'
              : 'Customer managed'}
        </span>
      </button>
      {open && (
        <div className="border-t border-zGray-850 py-2 space-y-2">
          {policy.arn && (
            <div className="font-mono text-[11px] text-tertiary truncate" title={policy.arn}>
              {policy.arn}
            </div>
          )}
          {policy.versionId && (
            <div className="text-[11px] text-tertiary">
              Version {policy.versionId}
              {policy.updatedAt && <> · updated {formatAge(policy.updatedAt)} ago</>}
            </div>
          )}
          {policy.statements.length === 0 ? (
            <div className="text-[11.5px] text-tertiary italic">
              Policy document was not readable (likely missing iam:GetPolicyVersion).
            </div>
          ) : (
            <div className="space-y-1.5">
              {policy.statements.map((s, idx) => (
                <StatementRow key={idx} statement={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatementRow({ statement }: { statement: AwsIamStatement }) {
  const allow = statement.effect === 'Allow'
  const usesNotResource =
    statement.resources.length === 0 && (statement.notResources?.length ?? 0) > 0
  const resourceList = usesNotResource ? (statement.notResources ?? []) : statement.resources
  const actionList = statement.actions.length > 0 ? statement.actions : (statement.notActions ?? [])
  const resourceText = truncatedInlineList(resourceList, 4)
  const actionText = truncatedInlineList(actionList, 8)

  return (
    <div
      className={clsx(
        'border-l-2 px-2.5 py-1.5 text-[11.5px]',
        allow ? 'border-success/50 bg-success/5' : 'border-error/50 bg-error/5',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            'text-[10.5px] uppercase tracking-wider font-semibold',
            allow ? 'text-success' : 'text-error',
          )}
        >
          {statement.effect}
        </span>
        <span className="text-tertiary">on</span>
        <span className="font-mono text-secondary truncate" title={resourceList.join(', ')}>
          {resourceText}
        </span>
        {usesNotResource && (
          <span className="text-tertiary text-[10.5px] uppercase tracking-wider">
            (NotResource)
          </span>
        )}
      </div>
      <div className="mt-1 font-mono text-secondary leading-relaxed" title={actionList.join(', ')}>
        {actionText}
        {statement.notActions &&
          statement.notActions.length > 0 &&
          statement.actions.length === 0 && <span className="text-tertiary"> (NotAction)</span>}
      </div>
      {statement.conditionSummary && (
        <div className="mt-1 text-tertiary font-mono break-all">
          when {statement.conditionSummary}
        </div>
      )}
    </div>
  )
}
