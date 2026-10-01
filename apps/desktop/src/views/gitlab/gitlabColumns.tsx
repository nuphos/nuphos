import { Age } from '../../components/Age'

import { pipelineStatusColor } from './pipelineStatus'
import { PipelineStatusIcon } from './PipelineStatusIcon'

import type { Column } from '../../components/Table'
import type { GitlabMergeRequest, GitlabPipeline } from '../../types'

export const mrColumns: Column<GitlabMergeRequest>[] = [
  {
    key: 'iid',
    header: '!',
    width: 60,
    sortAccessor: (m) => m.iid,
    render: (m) => <span className="text-tertiary text-[12px]">!{m.iid}</span>,
  },
  {
    key: 'title',
    header: 'Title',
    width: 320,
    sortAccessor: (m) => m.title,
    render: (m) => (
      <span className="text-main">
        {m.draft && (
          <span className="mr-1.5 text-[11px] text-tertiary border border-zGray-700 rounded px-1 py-0.5">
            Draft
          </span>
        )}
        {m.title}
      </span>
    ),
  },
  {
    key: 'author',
    header: 'Author',
    width: 140,
    sortAccessor: (m) => m.author ?? '',
    render: (m) => (
      <span className="inline-flex items-center gap-1.5">
        {m.authorAvatarUrl && (
          <img
            src={m.authorAvatarUrl}
            alt={m.author ?? ''}
            className="w-4 h-4 rounded-full flex-shrink-0"
          />
        )}
        <span className="text-secondary text-[12px]">{m.author ?? '—'}</span>
      </span>
    ),
  },
  {
    key: 'labels',
    header: 'Labels',
    width: 180,
    render: (m) =>
      m.labels.length === 0 ? (
        <span className="text-tertiary">—</span>
      ) : (
        <span className="inline-flex flex-wrap gap-1">
          {m.labels.map((l) => (
            <span
              key={l}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zGray-800 text-secondary"
            >
              {l}
            </span>
          ))}
        </span>
      ),
  },
  {
    key: 'branch',
    header: 'Branch',
    width: 220,
    render: (m) => (
      <span className="text-tertiary text-[11px] font-mono">
        {m.sourceBranch} → {m.targetBranch}
      </span>
    ),
  },
  {
    key: 'age',
    header: 'Age',
    width: 90,
    sortAccessor: (m) => m.createdAt,
    render: (m) => (
      <span className="text-tertiary">
        <Age value={m.createdAt} />
      </span>
    ),
  },
]

export const pipelineColumns: Column<GitlabPipeline>[] = [
  {
    key: 'id',
    header: '#',
    width: 80,
    sortAccessor: (p) => p.id,
    render: (p) => <span className="text-main text-[12px]">#{p.id}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: 130,
    sortAccessor: (p) => p.status,
    render: (p) => (
      <span className={`inline-flex items-center gap-1.5 ${pipelineStatusColor(p)}`}>
        <PipelineStatusIcon p={p} />
        <span className="text-[12px] capitalize">{p.status}</span>
      </span>
    ),
  },
  {
    key: 'source',
    header: 'Trigger',
    width: 130,
    render: (p) => <span className="text-secondary text-[12px]">{p.source}</span>,
  },
  {
    key: 'ref',
    header: 'Ref',
    width: 180,
    sortAccessor: (p) => p.ref ?? '',
    render: (p) => <span className="text-tertiary text-[11px] font-mono">{p.ref ?? '—'}</span>,
  },
  {
    key: 'sha',
    header: 'Commit',
    width: 90,
    render: (p) => <span className="text-tertiary text-[11px] font-mono">{p.sha.slice(0, 8)}</span>,
  },
  {
    key: 'age',
    header: 'Age',
    width: 90,
    sortAccessor: (p) => p.createdAt,
    render: (p) => (
      <span className="text-tertiary">
        <Age value={p.createdAt} />
      </span>
    ),
  },
]
