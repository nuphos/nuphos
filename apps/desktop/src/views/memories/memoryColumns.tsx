import clsx from 'clsx'

import { Age } from '../../components/Age'
import { t } from '../../i18n'

import type { AgentMemoryItem, AgentMemoryScore } from '../../api'
import type { Column } from '../../components/Table'

export function buildMemoryColumns(
  stateFilter: 'live' | 'removed',
  scores: Record<string, AgentMemoryScore>,
): Column<AgentMemoryItem>[] {
  return [
    {
      key: 'type',
      header: t('Type'),
      width: 100,
      sortAccessor: (r) => r.type,
      render: (r) => (
        <span className="uppercase tracking-wide text-[11px] text-secondary">{r.type}</span>
      ),
    },
    {
      key: 'text',
      header: t('Content'),
      width: 560,
      sortAccessor: (r) => r.title ?? r.text,
      render: (r) => (
        <div className="min-w-0" title={r.title ? `${r.title}\n${r.text}` : r.text}>
          <span className="text-main truncate block">{r.title ?? r.text}</span>
          {r.title && <span className="text-tertiary truncate block text-[11px]">{r.text}</span>}
        </div>
      ),
    },
    {
      key: 'categories',
      header: t('Categories'),
      width: 200,
      sortAccessor: (r) => r.categories.join(','),
      render: (r) =>
        r.categories.length === 0 ? (
          <span className="text-tertiary">—</span>
        ) : (
          <span className="text-secondary truncate block" title={r.categories.join(', ')}>
            {r.categories.join(', ')}
          </span>
        ),
    },
    // Track A 2.3: verified usage per memory. "—" = never observed in
    // the window; a red dot marks memories that were superseded.
    ...(stateFilter === 'live'
      ? [
          {
            key: 'used',
            header: t('Used'),
            width: 100,
            sortAccessor: (r: AgentMemoryItem) => scores[r.id]?.applyRate ?? -1,
            render: (r: AgentMemoryItem) => {
              const s = scores[r.id]

              if (!s || s.turns === 0) return <span className="text-tertiary">—</span>
              const reach =
                s.reachConversations === 1
                  ? t('reached {count} agent', { count: String(s.reachConversations) })
                  : t('reached {count} agents', { count: String(s.reachConversations) })
              const corrected =
                s.corrections > 0
                  ? ` · ${t('corrected {count}×', { count: String(s.corrections) })}`
                  : ''

              return (
                <span
                  className={clsx(
                    'font-mono text-[12px]',
                    s.applied > 0 ? 'text-emerald-500' : 'text-tertiary',
                  )}
                  title={`${t('Verified as used in {applied} of {turns} observed turns', { applied: String(s.applied), turns: String(s.turns) })} · ${reach}${corrected}`}
                >
                  {s.applied}/{s.turns}
                  {s.corrections > 0 && <span className="text-red-400"> ●</span>}
                </span>
              )
            },
          },
          {
            key: 'lastUsed',
            header: t('Last used'),
            width: 100,
            sortAccessor: (r: AgentMemoryItem) => scores[r.id]?.lastAppliedAt ?? '',
            render: (r: AgentMemoryItem) => {
              const usedAt = scores[r.id]?.lastAppliedAt

              return (
                <span className="text-tertiary font-mono text-[12px]">
                  {usedAt ? <Age value={usedAt} /> : '—'}
                </span>
              )
            },
          },
        ]
      : []),
    stateFilter === 'removed'
      ? {
          key: 'removed',
          header: t('Removed'),
          width: 150,
          sortAccessor: (r) => r.disabledAt ?? '',
          render: (r) => (
            <span
              className="text-tertiary font-mono text-[12px]"
              title={
                [
                  r.disabledBy ? t('Removed by {name}', { name: r.disabledBy }) : '',
                  r.disabledReason ? t('Reason: {reason}', { reason: r.disabledReason }) : '',
                ]
                  .filter(Boolean)
                  .join(' — ') || undefined
              }
            >
              {r.disabledAt ? <Age value={r.disabledAt} /> : '—'}
            </span>
          ),
        }
      : {
          key: 'created',
          header: t('Created'),
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
