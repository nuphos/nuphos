import { AlertTriangle } from 'lucide-react'

import { Age } from '../../components/Age'
import { formatBytes } from '../../grafana/format'

import type { TeamSkillSummary } from '../../api'
import type { Column } from '../../components/Table'

export function buildSkillColumns(): Column<TeamSkillSummary>[] {
  return [
    {
      key: 'name',
      header: 'Skill',
      width: 220,
      // Which skill a row *is*. Description alone is 420px, so the name is the
      // first thing a sideways scroll takes away.
      pin: 'left',
      sortAccessor: (row) => row.name,
      render: (row) => (
        <div className="min-w-0">
          <span className="text-main truncate block" title={row.displayName}>
            {row.displayName}
          </span>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-tertiary">
            <span className="font-mono truncate">{row.name}</span>
            {!row.hasSkillMd && (
              <span className="inline-flex items-center gap-0.5 text-red-400" title="No SKILL.md">
                <AlertTriangle className="w-3 h-3" strokeWidth={1.8} />
                no SKILL.md
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      width: 420,
      sortAccessor: (row) => row.description ?? '',
      render: (row) => (
        <span className="text-secondary truncate block" title={row.description ?? undefined}>
          {row.description || <span className="text-tertiary italic">No description</span>}
        </span>
      ),
    },
    {
      key: 'files',
      header: 'Files',
      width: 72,
      sortAccessor: (row) => row.fileCount,
      render: (row) => <span className="text-tertiary font-mono text-[12px]">{row.fileCount}</span>,
    },
    {
      key: 'size',
      header: 'Size',
      width: 96,
      sortAccessor: (row) => row.totalBytes,
      render: (row) => (
        <span className="text-tertiary font-mono text-[12px]">{formatBytes(row.totalBytes)}</span>
      ),
    },
    {
      key: 'revision',
      header: 'Revision',
      width: 82,
      sortAccessor: (row) => row.metadata?.revision ?? 0,
      render: (row) => (
        <span className="text-tertiary font-mono text-[12px]">
          {!row.metadata
            ? '—'
            : row.metadata.legacy
              ? 'legacy'
              : `r${String(row.metadata.revision)}`}
        </span>
      ),
    },
    {
      key: 'modified',
      header: 'Modified',
      width: 110,
      sortAccessor: (row) => row.lastModified ?? '',
      render: (row) => (
        <span className="text-tertiary font-mono text-[12px]">
          {row.lastModified ? <Age value={row.lastModified} /> : '—'}
        </span>
      ),
    },
  ]
}
