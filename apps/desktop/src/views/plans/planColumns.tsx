import { ShieldCheck } from 'lucide-react'

import { Age } from '../../components/Age'
import { PlanStatusBadge } from '../../components/agent/PlanTool'
import { MemberCell } from '../../components/MemberCell'

import { ProgressCell } from './PlanCells'
import { memberDisplayName, progressFraction } from './planProgress'
import { proposalPlanStatus } from './planRows'

import type { Row } from './planRows'
import type { Column } from '../../components/Table'
import type { TeamMember } from '../../types'

export function buildPlanColumns(membersById: Map<string, TeamMember>): Column<Row>[] {
  return [
    {
      key: 'title',
      header: 'Title',
      // Ahead of "#" and pinned: the number identifies a plan to the system,
      // the title identifies it to the reader, and a row scrolled past Created
      // by is one you can act on without knowing what it says. Narrower than
      // it was — pinned width is paid at every scroll position.
      width: 280,
      pin: 'left',
      sortAccessor: (r) => (r.kind === 'plan' ? r.plan.title : r.proposal.grantLabel),
      render: (r) => {
        const title = r.kind === 'plan' ? r.plan.title : r.proposal.grantLabel

        return (
          <span className="text-main truncate block" title={title}>
            {title}
          </span>
        )
      },
    },
    {
      key: 'number',
      header: '#',
      width: 64,
      sortAccessor: (r) => (r.kind === 'plan' ? (r.plan.number ?? 0) : 0),
      render: (r) =>
        r.kind === 'plan' ? (
          <span className="font-mono text-[12px] text-tertiary">
            {typeof r.plan.number === 'number' ? `#${String(r.plan.number)}` : '—'}
          </span>
        ) : (
          <ShieldCheck
            className="h-3.5 w-3.5 text-zViolet-accent"
            strokeWidth={1.8}
            aria-label="Permission request"
          />
        ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 130,
      sortAccessor: (r) =>
        r.kind === 'plan' ? r.plan.status : proposalPlanStatus(r.proposal.status),
      render: (r) => (
        <PlanStatusBadge
          status={r.kind === 'plan' ? r.plan.status : proposalPlanStatus(r.proposal.status)}
        />
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      width: 140,
      sortAccessor: (r) => (r.kind === 'plan' ? progressFraction(r.plan) : -1),
      render: (r) =>
        r.kind === 'plan' ? (
          <ProgressCell plan={r.plan} />
        ) : (
          <span className="text-tertiary text-[12px]">—</span>
        ),
    },
    {
      key: 'createdBy',
      header: 'Created by',
      width: 260,
      sortAccessor: (r) => {
        const member = membersById.get(r.createdBy)

        return member ? `${memberDisplayName(member)} ${member.email}` : ''
      },
      render: (r) => <MemberCell member={membersById.get(r.createdBy) ?? null} />,
    },
    {
      key: 'created',
      header: 'Created',
      width: 110,
      sortAccessor: (r) => r.createdAt,
      render: (r) => (
        <span className="text-tertiary font-mono text-[12px]">
          <Age value={r.createdAt} />
        </span>
      ),
    },
  ]
}
