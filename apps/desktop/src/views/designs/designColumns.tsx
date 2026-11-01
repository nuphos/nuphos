import { Palette } from 'lucide-react'

import { MemberCell } from '../../components/MemberCell'
import { t } from '../../i18n'
import { memberDisplayName } from '../../lib/bindingAccess'

import type { Column } from '../../components/Table'
import type { DesignSummary } from '../../design/schema'
import type { TeamMember } from '../../types'

const count = (n: number) => <span className="text-tertiary font-mono text-[12px]">{n}</span>

export function buildDesignColumns(membersById: Map<string, TeamMember>): Column<DesignSummary>[] {
  return [
    {
      key: 'name',
      header: t('Name'),
      sortAccessor: (d) => d.name.toLowerCase(),
      render: (d) => (
        <span className="inline-flex items-center gap-2 text-main">
          <Palette className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
          <span className="truncate">{d.name}</span>
        </span>
      ),
    },
    {
      key: 'pages',
      header: t('Pages'),
      width: 90,
      sortAccessor: (d) => d.pageCount,
      render: (d) => count(d.pageCount),
    },
    {
      key: 'frames',
      header: t('Screens'),
      width: 100,
      sortAccessor: (d) => d.frameCount,
      render: (d) => count(d.frameCount),
    },
    {
      key: 'createdBy',
      header: t('Created by'),
      width: 220,
      sortAccessor: (d) => {
        const member = membersById.get(d.createdBy)

        return member ? memberDisplayName(member) : ''
      },
      render: (d) => <MemberCell member={membersById.get(d.createdBy) ?? null} compact />,
    },
    {
      key: 'updated',
      header: t('Updated'),
      width: 140,
      sortAccessor: (d) => d.updatedAt,
      render: (d) => (
        <span className="text-tertiary font-mono text-[12px]">
          {new Date(d.updatedAt).toLocaleDateString()}
        </span>
      ),
    },
  ]
}
