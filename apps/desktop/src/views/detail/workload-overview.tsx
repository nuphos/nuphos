/* eslint-disable max-lines -- the operational overview keeps its full visual hierarchy together. */
import {
  Activity,
  Boxes,
  Cable,
  GitCompareArrows,
  HardDrive,
  SlidersHorizontal,
  Tags,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { t } from '../../i18n'
import { healthClass, replicaTone } from '../../lib/k8sHealth'
import { readSwrCache, writeSwrCache } from '../../lib/swrCache'
import { useResetOnKey } from '../useResetOnKey'

import { DeploymentEnvTab } from './env-tab'
import {
  FactRow,
  OperationsCanvas,
  OperationsGrid,
  OperationsHero,
  OperationsPanel,
  ProgressFact,
} from './operations-layout'
import { parseResourceTopology } from './resource-topology'
import { ContainerSpecCards } from './resource-container-cards'
import { ConnectedResources, VolumeMap } from './resource-topology-section'
import { OverviewChipList } from './shared'
import { resourceYamlKey } from './target'
import { WorkloadPodsTab } from './workload-pods-tab'
import { hasEditableWorkloadEnv, parseWorkloadSummary } from './workload-summary'

import type { JobState } from './workload-summary'
import type { DetailTarget } from './target'
import type { HealthTone } from '../../lib/k8sHealth'

function workloadTone({
  desired,
  ready,
  conditionTones,
  jobState,
}: {
  desired: number
  ready: number
  conditionTones: (HealthTone | undefined)[]
  jobState: JobState | null
}): HealthTone {
  if (jobState === 'failed') return 'error'
  if (jobState === 'complete') return 'neutral'
  if (jobState === 'suspended') return 'neutral'
  if (jobState === 'running' || jobState === 'completing' || jobState === 'pending')
    return 'warning'
  if (conditionTones.includes('error')) return 'error'

  return replicaTone(ready, desired)
}

function workloadHealthTitle(tone: HealthTone, desired: number, jobState: JobState | null) {
  if (jobState === 'complete') return t('Run completed')
  if (jobState === 'failed') return t('Run failed')
  if (jobState === 'suspended') return t('Run suspended')
  if (jobState === 'completing') return t('Run completing')
  if (jobState === 'running') return t('Run in progress')
  if (jobState === 'pending') return t('Run pending')
  if (desired === 0) return t('Scaled to zero')
  if (tone === 'success') return t('Fully available')
  if (tone === 'error') return t('Capacity unavailable')
  if (tone === 'warning') return t('Rollout still converging')

  return t('Inactive')
}

function metricTone(value: number, desired: number): HealthTone {
  return replicaTone(value, desired)
}

export function WorkloadOverview({
  target,
  refreshKey,
  onNavigate,
}: {
  target: DetailTarget
  refreshKey: number
  onNavigate?: (target: DetailTarget) => void
}) {
  const context = useRequiredKubeContext()
  const cacheKey = `workload-overview:${resourceYamlKey(context, target)}`
  const [yamlText, setYamlText] = useState<string | null>(
    () => readSwrCache<string>(cacheKey) ?? null,
  )
  const [error, setError] = useState<string | null>(null)

  useResetOnKey(cacheKey, () => {
    setYamlText(readSwrCache<string>(cacheKey) ?? null)
    setError(null)
  })

  useEffect(() => {
    let cancelled = false
    const cached = readSwrCache<string>(cacheKey)

    api
      .getResourceYaml(
        context,
        target.kind,
        target.namespace,
        target.name,
        target.apiVersion,
        target.plural,
      )
      .then((nextYaml) => {
        if (cancelled) return
        writeSwrCache(cacheKey, nextYaml)
        setError(null)
        setYamlText(nextYaml)
      })
      .catch((e: unknown) => {
        if (cancelled || cached) return
        setError(String(e instanceof Error ? e.message : e))
      })

    return () => {
      cancelled = true
    }
  }, [
    cacheKey,
    context,
    target.kind,
    target.namespace,
    target.name,
    target.apiVersion,
    target.plural,
    refreshKey,
  ])

  if (error) return <div className="p-6 text-error text-[13px]">{error}</div>
  if (!yamlText) return <div className="p-6 text-tertiary text-[13px]">{t('Loading…')}</div>

  const summary = parseWorkloadSummary(yamlText, target)
  const topology = parseResourceTopology(yamlText, target)
  const isJob = target.kind === 'Job'
  const tone = workloadTone({
    desired: summary.desired,
    ready: summary.ready,
    conditionTones: summary.conditions.map((condition) => condition.tone),
    jobState: summary.jobState,
  })
  const generationText = summary.generation
    ? summary.observedGeneration
      ? `${String(summary.observedGeneration)}/${String(summary.generation)}`
      : String(summary.generation)
    : '-'
  const readyLabel = isJob ? t('Succeeded') : t('Ready')
  const availableLabel = isJob ? t('Active') : t('Available')
  const updatedLabel = isJob
    ? t('Failed')
    : target.kind === 'ReplicaSet'
      ? t('Current')
      : t('Updated')
  const readyTone =
    isJob && summary.ready >= summary.desired
      ? 'neutral'
      : metricTone(summary.ready, summary.desired)
  const availableTone = isJob
    ? summary.available > 0
      ? ('warning' as const)
      : ('neutral' as const)
    : metricTone(summary.available, summary.desired)
  const updatedTone = isJob
    ? summary.updated > 0
      ? ('error' as const)
      : ('neutral' as const)
    : metricTone(summary.updated, summary.desired)

  return (
    <OperationsCanvas>
      <OperationsHero
        eyebrow={t('{kind} health', { kind: summary.kind })}
        title={workloadHealthTitle(tone, summary.desired, summary.jobState)}
        tone={tone}
        badge={
          <span
            className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium ${healthClass[tone]}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {readyLabel} {summary.ready}/{summary.desired}
          </span>
        }
        description={
          isJob
            ? t('{active} active · {failed} failed attempts', {
                active: summary.available,
                failed: summary.updated,
              })
            : t('{available} available · {updated} updated · {strategy} strategy', {
                available: summary.available,
                updated: summary.updated,
                strategy: summary.update,
              })
        }
        facts={[
          { label: readyLabel, value: `${String(summary.ready)} / ${String(summary.desired)}` },
          {
            label: availableLabel,
            value: String(summary.available),
            detail: t('{count} desired', { count: summary.desired }),
          },
          {
            label: updatedLabel,
            value: String(summary.updated),
            detail: isJob
              ? t('controller attempts')
              : target.kind === 'ReplicaSet'
                ? t('observed replicas')
                : t('current revision'),
          },
          {
            label: t('Strategy'),
            value: summary.update,
            detail: t('generation {generation}', { generation: generationText }),
          },
          { label: t('Age'), value: summary.createdAt ? <Age value={summary.createdAt} /> : '-' },
          {
            label: t('Namespace'),
            value: <span className="text-zViolet-accent">{summary.namespace}</span>,
          },
        ]}
      />

      <OperationsGrid>
        {target.namespace && (
          <OperationsPanel
            title={t('Live Pods')}
            description={t('Pods currently matching this workload selector')}
            meta={summary.selector.length > 0 ? t('selector matched') : undefined}
            icon={<Boxes className="h-3.5 w-3.5" strokeWidth={1.8} />}
            className="@5xl:col-span-8"
            bodyClassName="h-[390px] min-h-0"
          >
            <WorkloadPodsTab
              kind={target.kind}
              namespace={target.namespace}
              name={target.name}
              onNavigate={onNavigate}
            />
          </OperationsPanel>
        )}

        <OperationsPanel
          title={isJob ? t('Run progress') : t('Rollout convergence')}
          description={
            isJob
              ? t('Completions and controller activity')
              : t('Desired state against observed state')
          }
          icon={<Activity className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className={target.namespace ? '@5xl:col-span-4' : '@5xl:col-span-12'}
          bodyClassName="p-4 @2xl:p-5"
        >
          <div className="space-y-4">
            <ProgressFact
              label={readyLabel}
              value={summary.ready}
              desired={summary.desired}
              tone={readyTone}
            />
            <ProgressFact
              label={availableLabel}
              value={summary.available}
              desired={summary.desired}
              tone={availableTone}
            />
            <ProgressFact
              label={updatedLabel}
              value={summary.updated}
              desired={summary.desired}
              tone={updatedTone}
            />
          </div>
          <div className="mt-5 border-t border-zGray-800 pt-4">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-tertiary">
              {t('Conditions')}
            </div>
            <OverviewChipList chips={summary.conditions} empty={t('No conditions reported')} />
          </div>
        </OperationsPanel>

        <OperationsPanel
          title={t('Pod template containers')}
          description={t('Container settings used when this workload creates Pods')}
          meta={t('{count} containers', { count: topology.containers.length })}
          icon={<GitCompareArrows className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-7"
        >
          <ContainerSpecCards containers={topology.containers} />
        </OperationsPanel>

        <OperationsPanel
          title={t('Dependencies')}
          description={t('Configuration, storage and runtime references')}
          meta={t('{count} references', { count: topology.relations.length })}
          icon={<Cable className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-5"
        >
          <ConnectedResources relations={topology.relations} onNavigate={onNavigate} />
        </OperationsPanel>

        <OperationsPanel
          title={t('Pod template storage routes')}
          description={t('Volume source → template container mount path')}
          meta={t('{count} volumes', { count: topology.volumes.length })}
          icon={<HardDrive className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-7"
        >
          <VolumeMap topology={topology} namespace={target.namespace} onNavigate={onNavigate} />
        </OperationsPanel>

        <OperationsPanel
          title={t('Workload identity')}
          description={t('Selection, revision and API metadata')}
          icon={<Tags className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-5"
          bodyClassName="p-4 @2xl:p-5"
        >
          <div className="px-0.5">
            <FactRow label={t('Revision')} value={summary.revision ?? '-'} mono />
            <FactRow label={t('Generation')} value={generationText} mono />
            <FactRow label={t('Service account')} value={summary.serviceAccount} />
            <FactRow label={t('API')} value={`${summary.apiVersion} · ${summary.kind}`} />
          </div>
          <div className="mt-4 border-t border-zGray-800 pt-4">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-tertiary">
              {t('Selector')}
            </div>
            <OverviewChipList chips={summary.selector} />
          </div>
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-tertiary">
              {t('Template labels')}
            </div>
            <OverviewChipList chips={summary.templateLabels} />
          </div>
        </OperationsPanel>

        {target.namespace && hasEditableWorkloadEnv(target.kind) && (
          <OperationsPanel
            title={t('Pod template environment')}
            description={t('Container-scoped values copied into newly created Pods')}
            icon={<SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />}
            className="@5xl:col-span-12"
          >
            <DeploymentEnvTab
              kind={target.kind}
              namespace={target.namespace}
              name={target.name}
              onNavigate={onNavigate}
              embedded
            />
          </OperationsPanel>
        )}
      </OperationsGrid>
    </OperationsCanvas>
  )
}
