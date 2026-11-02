import { Copy, Globe, Pencil } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { useReportLoading } from '../../components/useReportLoading'
import { t } from '../../i18n'
import { useResetOnKey } from '../useResetOnKey'

import { ErrorBlock } from './ErrorBlock'
import { LambdaConfigEditModal } from './lambda-config-edit'
import { lambdaConsoleUrl, lambdaStateClass } from './lambda-helpers'
import { LambdaMetricsPanel } from './lambda-metrics'
import { LambdaOverviewPanel } from './lambda-overview'
import { LambdaTestPanel, LambdaTriggersPanel } from './lambda-panels'
import { LogGroupEventsView } from './log-group-events'

import type {
  AwsLambdaFunction,
  AwsLambdaFunctionDetail,
  AwsLambdaInvokeResult,
  AwsLambdaMetricsResponse,
  AwsLambdaTriggers,
  AwsLogGroup,
  AwsLogGroupEvents,
  AwsLogSearchOptions,
  AwsLogSearchResult,
  AwsLogStreamListing,
} from '../../types'

const LAMBDA_TABS = ['Overview', 'Logs', 'Metrics', 'Test', 'Triggers'] as const

type LambdaTab = (typeof LAMBDA_TABS)[number]

const TAB_LABELS: Record<LambdaTab, string> = {
  Overview: t('Overview'),
  Logs: t('Logs'),
  Metrics: t('Metrics'),
  Test: t('Test'),
  Triggers: t('Triggers'),
}

export function LambdaFunctionDetailView({
  fn,
  detailLoader,
  metricsLoader,
  eventsLoader,
  searchEvents,
  listStreams,
  invoke,
  updateConfig,
  triggersLoader,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: {
  fn: AwsLambdaFunction
  detailLoader: (fn: AwsLambdaFunction) => Promise<AwsLambdaFunctionDetail>
  metricsLoader?: (fn: AwsLambdaFunction, rangeMinutes: number) => Promise<AwsLambdaMetricsResponse>
  eventsLoader?: (group: AwsLogGroup) => Promise<AwsLogGroupEvents>
  searchEvents?: (group: AwsLogGroup, options: AwsLogSearchOptions) => Promise<AwsLogSearchResult>
  listStreams?: (group: AwsLogGroup, nextToken?: string) => Promise<AwsLogStreamListing>
  invoke?: (fn: AwsLambdaFunction, payload: string) => Promise<AwsLambdaInvokeResult>
  updateConfig?: (
    fn: AwsLambdaFunction,
    updates: { memoryMb?: number; timeoutSec?: number; environment?: Record<string, string> },
  ) => Promise<void>
  triggersLoader?: (fn: AwsLambdaFunction) => Promise<AwsLambdaTriggers>
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}) {
  const [tab, setTab] = useState<LambdaTab>('Overview')
  const [detail, setDetail] = useState<AwsLambdaFunctionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [editOpen, setEditOpen] = useState(false)
  const detailLoaderRef = useRef(detailLoader)
  const fnRef = useRef(fn)

  useEffect(() => {
    detailLoaderRef.current = detailLoader
    fnRef.current = fn
  })
  useReportLoading(tab === 'Overview' && detailLoading, onLoading)

  useResetOnKey(`${fn.name}|${fn.region}|${String(reloadTick)}|${String(refreshKey)}`, () => {
    setDetailLoading(true)
    setDetailError(null)
  })
  useEffect(() => {
    let cancelled = false

    detailLoaderRef
      .current(fnRef.current)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        setDetailLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setDetailError(String(e instanceof Error ? e.message : e))
        setDetailLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [fn.name, fn.region, reloadTick, refreshKey])

  useEffect(() => {
    if (tab === 'Overview') onCount(detail ? 1 : 0)
  }, [tab, detail, onCount])

  const logGroup: AwsLogGroup = {
    name: detail?.logGroup ?? `/aws/lambda/${fn.name}`,
    arn: null,
    region: fn.region,
    createdAt: null,
    retentionDays: null,
    storedBytes: null,
    logGroupClass: null,
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-zGray-800 flex items-center gap-3 text-[11.5px]">
        <span className="text-secondary px-1.5 py-0.5 rounded bg-zGray-800/60 shrink-0">
          {fn.region}
        </span>
        {detail?.state && (
          <span className={`shrink-0 ${lambdaStateClass(detail.state)}`}>{detail.state}</span>
        )}
        <div className="ml-1 flex items-center gap-1 shrink-0">
          {LAMBDA_TABS.map((name) => {
            if (name === 'Logs' && !eventsLoader) return null
            if (name === 'Metrics' && !metricsLoader) return null
            if (name === 'Test' && !invoke) return null
            if (name === 'Triggers' && !triggersLoader) return null

            return (
              <button
                key={name}
                type="button"
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  setTab(name)
                }}
                onClick={(event) => {
                  if (event.detail !== 0) return
                  setTab(name)
                }}
                className={`h-6 px-2 rounded text-[11.5px] font-medium ${
                  tab === name
                    ? 'bg-zViolet-accent/15 text-zViolet-accent'
                    : 'text-tertiary hover:text-main hover:bg-zGray-850'
                }`}
              >
                {TAB_LABELS[name]}
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {tab === 'Overview' && updateConfig && detail && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1 text-tertiary hover:text-main"
              title={t('Edit memory, timeout and environment variables')}
            >
              <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
              {t('Edit')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(detail?.arn || fn.arn)}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main"
            title={t('Copy function ARN')}
          >
            <Copy className="w-3.5 h-3.5" strokeWidth={1.8} />
            {t('Copy ARN')}
          </button>
          <button
            type="button"
            onClick={() => void api.appOpenExternal(lambdaConsoleUrl(fn))}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main"
          >
            <Globe className="w-3.5 h-3.5" strokeWidth={1.8} />
            {t('AWS console')}
          </button>
        </div>
      </div>

      {tab === 'Overview' &&
        (detailError ? (
          <ErrorBlock message={detailError} />
        ) : detailLoading && !detail ? (
          <div className="flex-1 flex items-center justify-center text-sm text-tertiary">
            {t('Loading configuration...')}
          </div>
        ) : detail ? (
          <LambdaOverviewPanel detail={detail} />
        ) : null)}

      {tab === 'Logs' && eventsLoader && (
        <div className="flex-1 min-h-0 flex flex-col">
          <LogGroupEventsView
            group={logGroup}
            loadEvents={eventsLoader}
            searchEvents={searchEvents}
            listStreams={listStreams}
            filter={filter}
            refreshKey={refreshKey}
            onCount={onCount}
            onLoading={onLoading}
          />
        </div>
      )}

      {tab === 'Metrics' && metricsLoader && (
        <LambdaMetricsPanel
          fn={fn}
          loader={metricsLoader}
          onCount={onCount}
          onLoading={onLoading}
        />
      )}

      {tab === 'Test' && invoke && <LambdaTestPanel fn={fn} invoke={invoke} onCount={onCount} />}

      {tab === 'Triggers' && triggersLoader && (
        <LambdaTriggersPanel
          fn={fn}
          loader={triggersLoader}
          onCount={onCount}
          onLoading={onLoading}
          refreshKey={refreshKey}
        />
      )}

      {editOpen && detail && updateConfig && (
        <LambdaConfigEditModal
          fn={fn}
          detail={detail}
          updateConfig={updateConfig}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false)
            setReloadTick((n) => n + 1)
          }}
        />
      )}
    </div>
  )
}
