import clsx from 'clsx'
import { RotateCcw, Trash2, X } from 'lucide-react'

import { DetailSidebarTransition } from '../../components/DetailSidebarTransition'
import { t } from '../../i18n'

import { DetailBlock, DetailGrid } from './DetailBlocks'
import { GeneDetail } from './GeneDetail'

import type { AgentMemoryItem, AgentMemoryScope, AgentMemoryScore } from '../../api'

export function MemoryDetailPane({
  memory,
  score,
  scope,
  loading,
  onRestore,
  onDelete,
  onClose,
}: {
  memory: AgentMemoryItem
  score?: AgentMemoryScore
  scope: AgentMemoryScope
  loading: boolean
  // Present only in the Removed view: a VISIBLE restore action — the row
  // context menu alone is unreachable for keyboard and touch users (review).
  onRestore?: () => void
  // Present only in the Active view: same reachability argument as onRestore.
  // Opens the view-level removal dialog (shared with the context menu) so the
  // optional reason capture lives in exactly one place.
  onDelete?: () => void
  onClose: () => void
}) {
  return (
    <DetailSidebarTransition
      onClose={onClose}
      className="w-[360px] flex-shrink-0 min-h-0 flex flex-col bg-zGray-925/40"
    >
      {(requestClose) => (
        <>
          <div className="px-4 py-3 border-b border-zGray-800/60 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] uppercase tracking-wide text-tertiary">
                {scope === 'team' ? t('Team shared memory') : t('Personal memory')}
              </div>
              <div className="text-[13px] text-main truncate">{memory.type}</div>
            </div>
            <div className="flex items-center gap-1.5">
              {onRestore && (
                <button
                  type="button"
                  onClick={onRestore}
                  className="h-7 px-2 rounded-md text-[12px] text-tertiary hover:text-main hover:bg-zGray-800 flex items-center gap-1.5"
                  title={t('Restore this memory')}
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {t('Restore')}
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="h-7 px-2 rounded-md text-[12px] text-tertiary hover:text-red-400 hover:bg-zGray-800 flex items-center gap-1.5"
                  title={t('Remove this memory')}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {t('Remove')}
                </button>
              )}
              <button
                type="button"
                onClick={requestClose}
                className="h-7 w-7 rounded-md text-tertiary hover:text-main hover:bg-zGray-800 flex items-center justify-center"
                title={t('Close details')}
                aria-label={t('Close details')}
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
            <div
              key={memory.id}
              className={clsx(
                't-skel t-memory-detail-reveal text-[12.5px]',
                !loading && 'is-revealed',
              )}
              data-state={loading ? 'loading' : 'revealed'}
            >
              <div className="t-skel-skeleton is-pulsing p-4 space-y-4" aria-hidden="true">
                <div className="space-y-2">
                  <div className="h-2.5 w-16 rounded bg-zGray-800" />
                  <div className="space-y-1.5">
                    <div className="h-3 w-full rounded bg-zGray-850" />
                    <div className="h-3 w-5/6 rounded bg-zGray-850" />
                    <div className="h-3 w-2/3 rounded bg-zGray-850" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-2.5 w-20 rounded bg-zGray-800" />
                  <div className="flex gap-1.5">
                    <div className="h-6 w-16 rounded-md bg-zGray-850" />
                    <div className="h-6 w-20 rounded-md bg-zGray-850" />
                  </div>
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="grid grid-cols-[92px_minmax(0,1fr)] gap-2">
                      <div className="h-3 rounded bg-zGray-850" />
                      <div className="h-3 rounded bg-zGray-850" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="t-skel-content p-4 space-y-4">
                {memory.gene ? (
                  <GeneDetail gene={memory.gene} />
                ) : (
                  <>
                    {memory.title && (
                      <DetailBlock label={t('Title')}>
                        <div className="leading-relaxed text-main">{memory.title}</div>
                      </DetailBlock>
                    )}
                    <DetailBlock label={t('Content')}>
                      <div className="whitespace-pre-wrap leading-relaxed text-main">
                        {memory.text}
                      </div>
                    </DetailBlock>
                  </>
                )}
                <DetailBlock label={t('Categories')}>
                  {memory.categories.length === 0 ? (
                    <span className="text-tertiary">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {memory.categories.map((category) => (
                        <span
                          key={category}
                          className="px-2 py-1 rounded-md bg-zGray-850 text-secondary"
                        >
                          {category}
                        </span>
                      ))}
                    </div>
                  )}
                </DetailBlock>
                {score && score.turns > 0 && (
                  <DetailBlock label={t('Usage (last 90 days)')}>
                    <DetailGrid
                      rows={[
                        [
                          t('Verified used'),
                          t('{applied} of {turns} observed turns', {
                            applied: String(score.applied),
                            turns: String(score.turns),
                          }),
                        ],
                        [
                          t('Reach'),
                          `${
                            score.reachConversations === 1
                              ? t('{count} conversation', { count: '1' })
                              : t('{count} conversations', {
                                  count: String(score.reachConversations),
                                })
                          } · ${
                            score.reachUsers === 1
                              ? t('{count} user', { count: '1' })
                              : t('{count} users', { count: String(score.reachUsers) })
                          }`,
                        ],
                        [
                          t('Corrected'),
                          score.corrections > 0 ? `${String(score.corrections)}×` : t('never'),
                        ],
                        [
                          t('Last used'),
                          score.lastAppliedAt
                            ? new Date(score.lastAppliedAt).toLocaleString()
                            : t('never'),
                        ],
                      ]}
                    />
                  </DetailBlock>
                )}
                <DetailGrid
                  rows={[
                    ...(memory.disabledReason
                      ? ([[t('Removal reason'), memory.disabledReason]] as [string, string][])
                      : []),
                    ['ID', memory.id],
                    [t('Type'), memory.type],
                    [t('Agent'), memory.convId ?? '—'],
                    [t('User scope'), memory.userId ?? '—'],
                    [t('App scope'), memory.appId ?? '—'],
                    [t('Group IDs'), memory.groupIds.length > 0 ? memory.groupIds.join(', ') : '—'],
                    [t('Created'), new Date(memory.createdAt).toLocaleString()],
                    [t('Updated'), new Date(memory.updatedAt).toLocaleString()],
                  ]}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </DetailSidebarTransition>
  )
}
