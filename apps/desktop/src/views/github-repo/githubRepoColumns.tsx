import { Age } from '../../components/Age'

import { runStatusColor } from './runStatus'
import { RunStatusIcon } from './RunStatusIcon'

import type { Column } from '../../components/Table'
import type { GithubPR, GithubWorkflowRun } from '../../types'

export const prColumns: Column<GithubPR>[] = [
  {
    key: 'number',
    header: '#',
    width: 60,
    sortAccessor: (pr) => pr.number,
    render: (pr) => <span className="text-tertiary text-[12px]">#{pr.number}</span>,
  },
  {
    key: 'title',
    header: 'Title',
    width: 320,
    sortAccessor: (pr) => pr.title,
    render: (pr) => (
      <span className="text-main">
        {pr.draft && (
          <span className="mr-1.5 text-[11px] text-tertiary border border-zGray-700 rounded px-1 py-0.5">
            Draft
          </span>
        )}
        {pr.title}
      </span>
    ),
  },
  {
    key: 'author',
    header: 'Author',
    width: 140,
    sortAccessor: (pr) => pr.author,
    render: (pr) => (
      <span className="inline-flex items-center gap-1.5">
        {pr.authorAvatarUrl && (
          <img
            src={pr.authorAvatarUrl}
            alt={pr.author}
            className="w-4 h-4 rounded-full flex-shrink-0"
          />
        )}
        <span className="text-secondary text-[12px]">{pr.author}</span>
      </span>
    ),
  },
  {
    key: 'labels',
    header: 'Labels',
    width: 180,
    render: (pr) =>
      pr.labels.length === 0 ? (
        <span className="text-tertiary">—</span>
      ) : (
        <span className="inline-flex flex-wrap gap-1">
          {pr.labels.map((l) => (
            <span
              key={l.name}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium text-black"
              style={{ backgroundColor: `#${l.color}` }}
            >
              {l.name}
            </span>
          ))}
        </span>
      ),
  },
  {
    key: 'branch',
    header: 'Branch',
    width: 200,
    render: (pr) => (
      <span className="text-tertiary text-[11px] font-mono">
        {pr.headRef} → {pr.baseRef}
      </span>
    ),
  },
  {
    key: 'age',
    header: 'Age',
    width: 90,
    sortAccessor: (pr) => pr.createdAt,
    render: (pr) => (
      <span className="text-tertiary">
        <Age value={pr.createdAt} />
      </span>
    ),
  },
]

export const runColumns: Column<GithubWorkflowRun>[] = [
  {
    key: 'name',
    header: 'Workflow',
    width: 220,
    sortAccessor: (r) => r.name,
    render: (r) => <span className="text-main">{r.name}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: 130,
    sortAccessor: (r) => r.conclusion ?? r.status,
    render: (r) => (
      <span className={`inline-flex items-center gap-1.5 ${runStatusColor(r)}`}>
        <RunStatusIcon run={r} />
        <span className="text-[12px] capitalize">{r.conclusion ?? r.status}</span>
      </span>
    ),
  },
  {
    key: 'event',
    header: 'Event',
    width: 110,
    render: (r) => <span className="text-secondary text-[12px]">{r.event}</span>,
  },
  {
    key: 'branch',
    header: 'Branch',
    width: 160,
    sortAccessor: (r) => r.headBranch,
    render: (r) => <span className="text-tertiary text-[11px] font-mono">{r.headBranch}</span>,
  },
  {
    key: 'commit',
    header: 'Commit',
    width: 80,
    render: (r) => (
      <span className="text-tertiary text-[11px] font-mono">{r.headSha.slice(0, 7)}</span>
    ),
  },
  {
    key: 'age',
    header: 'Age',
    width: 90,
    sortAccessor: (r) => r.createdAt,
    render: (r) => (
      <span className="text-tertiary">
        <Age value={r.createdAt} />
      </span>
    ),
  },
]
