import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { useReportVisibleError } from '../../VisibleErrorReporter'

import { MemoryLineHeader } from './MemoryProvenancePartView'

import type { MemoryIngestPart } from './parts'
import type { AgentMemoryIngestEventItem } from '../../../api'

/** The part's text is stored in the transcript in English; translate it only here. */
function memoryIngestLabel(text: string): string {
  if (text === 'Memory updated') return t('Memory updated')
  if (text === 'Memory update failed') return t('Memory update failed')
  const count = /^Memory updated \((\d+)\)$/.exec(text)?.[1]

  return count ? t('Memory updated ({n})', { n: count }) : text
}

export function MemoryIngestPartView({
  part,
  teamId,
}: {
  part: MemoryIngestPart
  teamId?: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [memories, setMemories] = useState<AgentMemoryIngestEventItem[] | null>(
    part.memories ?? null,
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [titleHydrationAttempted, setTitleHydrationAttempted] = useState(false)
  const errored = part.kind === 'error'
  const hasDetails = memories !== null
  const needsTitleHydration = memories?.some((memory) => !memory.title) ?? false

  useReportVisibleError(error ?? (errored ? part.text : null), 'agent_memory_ingest_error')

  const [syncedMemories, setSyncedMemories] = useState(part.memories)

  if (part.memories && part.memories !== syncedMemories) {
    setSyncedMemories(part.memories)
    setMemories(part.memories)
    setPending(false)
    setTitleHydrationAttempted(false)
  }

  async function toggleOpen() {
    const nextOpen = !open

    setOpen(nextOpen)
    if (
      !nextOpen ||
      loading ||
      (hasDetails && !needsTitleHydration) ||
      (needsTitleHydration && titleHydrationAttempted)
    ) {
      return
    }
    if (needsTitleHydration) setTitleHydrationAttempted(true)
    setLoading(true)
    setError(null)
    setPending(false)
    try {
      const page = await api.agentGetMemoryIngestEvent(part.sessionId, teamId, part.id)

      if (page.status === 'pending') {
        setPending(true)

        return
      }
      // A compatibility fetch must never erase useful embedded details when an
      // older backend does not recognize the persisted chip id.
      if (page.memories.length > 0 || memories === null) setMemories(page.memories)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="t-panel-slide t-agent-memory-event text-[12px] text-tertiary" data-open="true">
      <MemoryLineHeader
        label={memoryIngestLabel(part.text)}
        open={open}
        expandable
        errored={errored}
        onToggle={() => void toggleOpen()}
      />
      <div
        className={clsx(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <div className="pt-2 space-y-2">
            {loading && <div className="text-tertiary">{t('Loading memory details...')}</div>}
            {!loading && pending && (
              <div className="text-tertiary">{t('Memory update is still running.')}</div>
            )}
            {error && <div className="text-error">{error}</div>}
            {!loading && !pending && !error && memories?.length === 0 && (
              <div className="text-tertiary">{t('No memory was recorded for this turn.')}</div>
            )}
            {!loading &&
              !pending &&
              !error &&
              memories?.map((memory) => (
                <div
                  key={memory.id}
                  className="rounded-md border border-zGray-800/70 bg-zGray-900/40 px-2.5 py-2 space-y-1.5"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="uppercase tracking-wide text-[10.5px] text-tertiary">
                      {memory.type}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {memory.scopes.length === 0 ? (
                        <ScopeBadge label={t('Unknown scope')} />
                      ) : (
                        memory.scopes.map((scope) => (
                          <ScopeBadge
                            key={scope}
                            label={scope === 'team' ? t('Team shared') : t('Personal')}
                          />
                        ))
                      )}
                    </div>
                  </div>
                  {memory.title && (
                    <div className="text-main font-medium leading-snug">{memory.title}</div>
                  )}
                  <div className="text-secondary leading-relaxed whitespace-pre-wrap">
                    {memory.text}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ScopeBadge({ label }: { label: string }) {
  return (
    <span className="rounded bg-zGray-800 px-1.5 py-0.5 text-[10.5px] text-tertiary">{label}</span>
  )
}
