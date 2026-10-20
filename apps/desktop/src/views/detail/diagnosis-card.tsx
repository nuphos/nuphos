import { Collapsible } from '@base-ui/react/collapsible'
import clsx from 'clsx'
import { AlertTriangle, ChevronRight, History, OctagonAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { isDiagnosableKind, translate } from '../../lib/kube-insight.ts'
import { useResetOnKey } from '../useResetOnKey'

import { APP_UI_LOCALE, diagnosisView, visibleDiagnoses } from './diagnosis-model'

import type { DiagnosisView } from './diagnosis-model'
import type { DetailTarget } from './target'
import type { Locale, ResourceDiagnosis } from '../../lib/kube-insight.ts'

export type PreviousLogsRequest = { pod: string; container: string }

/** The pods listed inline before the rest collapse into "n more". */
const POD_PREVIEW = 3

function useResourceDiagnosis(target: DetailTarget, refreshKey: number) {
  const context = useRequiredKubeContext()
  const [result, setResult] = useState<ResourceDiagnosis | null>(null)
  const { kind, namespace, name } = target

  // Never show the previous resource's diagnosis under the next one's header.
  useResetOnKey(`${context}\0${kind}\0${namespace ?? ''}\0${name}`, () => setResult(null))

  useEffect(() => {
    if (!namespace || !isDiagnosableKind(kind)) return
    let cancelled = false

    api
      .getResourceDiagnosis(context, kind, namespace, name)
      .then((next) => {
        if (!cancelled) setResult(next)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setResult(null)
        toast.apiError('Could not diagnose this resource', e)
      })

    return () => {
      cancelled = true
    }
  }, [context, kind, namespace, name, refreshKey])

  return result
}

function DiagnosisRow({
  view,
  locale,
  onPreviousLogs,
}: {
  view: DiagnosisView
  locale: Locale
  onPreviousLogs: (request: PreviousLogsRequest) => void
}) {
  const Icon = view.severity === 'critical' ? OctagonAlert : AlertTriangle
  const shownPods = view.pods.slice(0, POD_PREVIEW)
  const hiddenPods = view.pods.length - shownPods.length

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2">
        <Icon
          className={clsx(
            'mt-0.5 h-4 w-4 shrink-0',
            view.severity === 'critical' ? 'text-error' : 'text-warning',
          )}
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] font-semibold text-main">{view.cause}</p>
            <span className="shrink-0 text-[11px] uppercase tracking-wider text-tertiary">
              {view.severityLabel}
            </span>
          </div>
          <p className="text-[12.5px] text-secondary">
            <span className="text-tertiary">{translate(locale, 'card.why')} · </span>
            {view.why}
          </p>
          <p className="text-[12.5px] text-secondary">
            <span className="text-tertiary">
              {translate(locale, 'card.fix')} ({view.fixKindLabel}) ·{' '}
            </span>
            {view.fix}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-tertiary">
            <span>
              {translate(locale, 'card.pods')}: {shownPods.join(', ')}
              {hiddenPods > 0 && ` · ${translate(locale, 'card.more', { count: hiddenPods })}`}
            </span>
            {view.previousLogs && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => view.previousLogs && onPreviousLogs(view.previousLogs)}
              >
                <History className="h-3.5 w-3.5" strokeWidth={2} />
                {translate(locale, 'card.previousLogs')}
              </Button>
            )}
          </div>
          <EvidencePanel view={view} locale={locale} />
        </div>
      </div>
    </div>
  )
}

function EvidencePanel({ view, locale }: { view: DiagnosisView; locale: Locale }) {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger className="group inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-tertiary hover:text-main/80">
        <ChevronRight
          className="h-3 w-3 transition-transform group-data-[panel-open]:rotate-90"
          strokeWidth={2}
        />
        {translate(locale, 'card.evidence')} ({view.evidence.length})
      </Collapsible.Trigger>
      <Collapsible.Panel className="t-acc-collapsible">
        <ul className="mt-1.5 space-y-1 border-l-2 border-zGray-800 pl-3 font-mono text-[11.5px]">
          {view.evidence.map((row, i) => (
            <li key={`${row.label}\0${String(i)}`} className="text-secondary selectable">
              <span className="text-tertiary">{row.label}</span>
              {row.detail && <span className="ml-2 text-main/80">{row.detail}</span>}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-3 text-[11.5px]">
          <span className="text-tertiary">{translate(locale, 'card.sources')}:</span>
          {view.sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zViolet-accent hover:underline"
            >
              {s.title}
            </a>
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

/**
 * "What is wrong, why, and how to fix it" for a Pod or workload, above the
 * detail tabs. Renders nothing while loading and when nothing is wrong.
 */
export function DiagnosisCard({
  target,
  refreshKey,
  onPreviousLogs,
}: {
  target: DetailTarget
  refreshKey: number
  onPreviousLogs: (request: PreviousLogsRequest) => void
}) {
  const result = useResourceDiagnosis(target, refreshKey)
  const locale = APP_UI_LOCALE
  const views = visibleDiagnoses(result).map((d) => diagnosisView(locale, d))

  if (views.length === 0) return null
  const critical = views.some((v) => v.severity === 'critical')

  return (
    <section
      aria-label={translate(locale, 'card.title')}
      className={clsx(
        'mt-3 divide-y divide-zGray-800 rounded-lg border px-4 py-3',
        critical ? 'border-error/30 bg-error/5' : 'border-warning/30 bg-warning/5',
      )}
    >
      {views.map((view) => (
        <DiagnosisRow key={view.id} view={view} locale={locale} onPreviousLogs={onPreviousLogs} />
      ))}
    </section>
  )
}
