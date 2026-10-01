import clsx from 'clsx'
import { Brain, ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../../api'
import { appliedCount, provenanceSummary } from '../../../lib/memoryRibbonSummary'

import { disclosureControlClass } from './partChrome'
import { fetchSessionTiers } from './sessionTiers'

import type { MemoryProvenancePart } from './parts'
import type { ReactNode } from 'react'

export function MemoryProvenancePartView({
  part,
  teamId,
  section = 'recalled',
}: {
  part: MemoryProvenancePart
  teamId?: string
  // A turn touches memory at two different moments, so one part renders in two
  // places: what recall put in front of the model before the turn started
  // (above the work), and what the agent went and looked up while working
  // (below it, next to what the turn learned). Splitting them is the whole
  // point — merged into one row they read as if they happened together.
  section?: 'recalled' | 'lookedUp'
}) {
  const [open, setOpen] = useState(false)
  // Only what had to be fetched. The frame's own labels are merged in below
  // rather than seeded into state: the finalizer frame replaces this part
  // mid-turn with a fuller label set, and state seeded once would keep showing
  // the first version.
  const [fetchedLabels, setFetchedLabels] = useState<Record<string, string>>({})
  // Fetched wins: it is the live record, whereas a frame's label is a snapshot
  // of the one-liner as it read when recall ran.
  const labels = useMemo(() => ({ ...part.labels, ...fetchedLabels }), [part.labels, fetchedLabels])
  // Track A tier per memory for THIS turn ('applied' | 'fetched' | …). Fetched
  // on expand for badges; ALSO fetched eagerly for every automatic frame,
  // because the tiers decide how the ribbon SETTLES. Evidence never vanishes
  // — the ribbon always renders and resolves its wording ladder: used
  // (verified) / merged recalled count. The delayed retry lets the post-hoc
  // judge land first.
  const [tiers, setTiers] = useState<Record<string, string>>({})
  const automatic = part.deliveryMode === 'automatic'
  const loadedCount = part.fetchedIds.length || part.fetchedCount
  const needEagerTiers = automatic

  useEffect(() => {
    if (!part.turnKey) return
    if (!open && !needEagerTiers) return
    let cancelled = false
    let retry: number | null = null
    const turnKey = part.turnKey
    const hasVerdict = (t: Record<string, string>) =>
      Object.values(t).some((v) => v === 'applied' || v === 'considered' || v === 'not_applicable')

    // Fetch immediately (shared per-session cache) so a conversation opened
    // from HISTORY settles its wording at once. Only a RECENT turn can still
    // be waiting on its verdict (judge lands seconds after the stream
    // closes) — that case gets exactly one delayed retry. Old verdict-less
    // turns (judge disabled) must not retry: with history that would be
    // every ribbon.
    void fetchSessionTiers(part.sessionId, teamId)
      .then((byTurn) => {
        if (cancelled) return
        const mine = byTurn.get(turnKey) ?? {}

        setTiers(mine)
        const ageMs = Date.now() - new Date(part.createdAt).getTime()

        if (!hasVerdict(mine) && Number.isFinite(ageMs) && ageMs < 10 * 60 * 1000) {
          retry = window.setTimeout(() => {
            void fetchSessionTiers(part.sessionId, teamId, { fresh: true })
              .then((b) => {
                if (!cancelled) setTiers(b.get(turnKey) ?? {})
              })
              .catch(() => {})
          }, 12_000)
        }
      })
      .catch(() => {}) // badges/wording are best-effort decoration

    return () => {
      cancelled = true
      if (retry) window.clearTimeout(retry)
    }
  }, [open, needEagerTiers, part.turnKey, part.sessionId, part.createdAt, teamId])
  // Injection/summary delivery rides the ENTIRE index along on every turn —
  // rendering that as "N memories shown" is constant noise (the same ~40
  // every time) and reads as "the answer used 40 memories". Only automatic
  // mode's query-selected recall earns the "shown" framing; for index-ride
  // modes the honest per-turn signal is what the agent actually loaded.
  // Legacy frames without deliveryMode keep the old rendering.
  const indexRide = part.deliveryMode != null && part.deliveryMode !== 'automatic'
  // Two sections: what turn-start recall put in front of the model, and what
  // the agent looked up itself with memory_get/search during the turn
  // (deduped against recall). The summary line reports their merged count.
  const { recalledEntries, lookedUpEntries } = useMemo(() => {
    const recalled = indexRide
      ? []
      : [
          ...part.personalIds.map((id) => ({ id, scope: 'personal' as const })),
          ...part.teamIds.map((id) => ({ id, scope: 'team' as const })),
        ]
    // Fetched-only items join the expandable list when the frame carries
    // their scope (older persisted frames don't — those stay count-only).
    const seen = new Set(recalled.map((e) => e.id))
    const lookedUp = [
      ...(part.fetchedPersonalIds ?? []).map((id) => ({ id, scope: 'personal' as const })),
      ...(part.fetchedTeamIds ?? []).map((id) => ({ id, scope: 'team' as const })),
    ].filter((e) => !seen.has(e.id))

    return { recalledEntries: recalled, lookedUpEntries: lookedUp }
  }, [indexRide, part.personalIds, part.teamIds, part.fetchedPersonalIds, part.fetchedTeamIds])
  const entries = useMemo(
    () => [...recalledEntries, ...lookedUpEntries],
    [recalledEntries, lookedUpEntries],
  )
  const recalledCount = part.personalIds.length + part.teamIds.length

  useEffect(() => {
    if (!open) return
    let cancelled = false

    void (async () => {
      const results = await Promise.all(
        entries
          .filter((e) => labels[e.id] === undefined)
          .map(async (e) => {
            try {
              const m = await api.agentGetMemory(e.id, teamId, e.scope)
              const label = m.title?.trim() || m.text.split('\n')[0].trim().slice(0, 120)

              return [e.id, label || 'Untitled memory'] as const
            } catch {
              return [e.id, 'Memory unavailable'] as const
            }
          }),
      )

      if (!cancelled && results.length) {
        setFetchedLabels((prev) => ({ ...prev, ...Object.fromEntries(results) }))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, entries, labels, teamId])

  if (recalledCount === 0 && part.fetchedCount === 0) return null
  // Index-ride turn with nothing actually loaded: nothing honest to say.
  if (indexRide && loadedCount === 0) return null
  // Automatic frames always render (evidence never vanishes) — the SUMMARY
  // below carries the honesty instead: it settles to 'N used' once the judge
  // verifies use, otherwise one merged 'N recalled' count that always
  // matches the expanded list.

  // Entries cover recalled ids plus scope-carrying fetches; only frames too
  // old to carry scope leave nothing to expand — without this guard the
  // chevron is a dead end for those.
  // Each moment shows only its own memories, and counts only those — the two
  // rows sit far apart in the transcript, so a merged count in either place
  // would not match the list under it.
  const shown = section === 'lookedUp' ? lookedUpEntries : recalledEntries

  if (shown.length === 0) return null
  const expandable = shown.length > 0
  // Honest split (ADR-0007 item 5): shown = what rode the prompt; loaded =
  // what the model actually pulled with memory_get (loadedCount computed
  // above, next to the tier effect that depends on it); used = what the
  // post-hoc judge confirmed the answer built on — counted over `shown`, so
  // the header can never outrun the badges listed beneath it.
  const usedCount = appliedCount(shown, tiers)
  const summary =
    section === 'lookedUp'
      ? `Looked up ${String(shown.length)} ${shown.length === 1 ? 'memory' : 'memories'}`
      : provenanceSummary({
          automatic,
          indexRide,
          usedCount,
          loadedCount,
          recalledCount: automatic ? shown.length || recalledCount : recalledCount,
        })

  return (
    <div className="my-1.5 text-[12px] text-tertiary">
      <MemoryLineHeader
        label={summary}
        open={open}
        expandable={expandable}
        onToggle={() => setOpen((v) => !v)}
      />
      <div
        className={clsx(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <div className="pt-1.5 ml-5 flex flex-col gap-0.5">
            {shown.map((e) => {
              const label = labels[e.id]

              return (
                <div
                  key={e.id}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 -ml-2 transition-colors hover:bg-zGray-900/60"
                >
                  <span
                    className={clsx(
                      'min-w-0 flex-1 truncate',
                      label ? 'text-secondary' : 'text-quaternary',
                    )}
                    title={label}
                  >
                    {label ?? 'Loading memory…'}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-quaternary">
                    {e.scope === 'team' ? 'Team' : 'Personal'}
                  </span>
                  {tiers[e.id] === 'applied' && (
                    <span className="shrink-0 rounded px-1.5 py-px text-[10.5px] font-medium bg-emerald-500/10 text-emerald-500">
                      ✓ used
                    </span>
                  )}
                  {tiers[e.id] === 'fetched' && (
                    <span className="shrink-0 rounded border border-current/20 px-1.5 py-px text-[10.5px] text-tertiary">
                      opened
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// Shared header row for the transcript's memory disclosure lines (provenance
// ribbon + learned chip) so they stay visually identical by construction:
// brain icon, count-first label, always-visible chevron that rotates open.
export function MemoryLineHeader({
  label,
  open,
  expandable,
  errored,
  onToggle,
}: {
  label: ReactNode
  open: boolean
  expandable: boolean
  errored?: boolean
  onToggle: () => void
}) {
  const inner = (
    <>
      {errored ? (
        <X className="w-3.5 h-3.5 flex-shrink-0 text-error" strokeWidth={2.2} />
      ) : (
        <Brain className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.6} />
      )}
      <span className="truncate text-left">{label}</span>
      {expandable && (
        <ChevronRight
          className={clsx('w-3.5 h-3.5 flex-shrink-0 transition-transform', open && 'rotate-90')}
          strokeWidth={1.6}
        />
      )}
    </>
  )

  return expandable ? (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={clsx(
        disclosureControlClass,
        'flex items-center gap-1.5 max-w-full transition-colors',
        errored ? 'text-error' : 'hover:text-secondary',
      )}
    >
      {inner}
    </button>
  ) : (
    <div className="flex items-center gap-1.5">{inner}</div>
  )
}
