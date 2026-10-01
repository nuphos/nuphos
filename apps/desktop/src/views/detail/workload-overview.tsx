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
  if (jobState === 'complete') return 'Run completed'
  if (jobState === 'failed') return 'Run failed'
  if (jobState === 'suspended') return 'Run suspended'
  if (jobState === 'completing') return 'Run completing'
  if (jobState === 'running') return 'Run in progress'
  if (jobState === 'pending') return 'Run pending'
  if (desired === 0) return 'Scaled to zero'
  if (tone === 'success') return 'Fully available'
  if (tone === 'error') return 'Capacity unavailable'
  if (tone === 'warning') return 'Rollout still converging'

  return 'Inactive'
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
  if (!yamlText) return <div className="p-6 text-tertiary text-[13px]">Loading…</div>

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
  const readyLabel = isJob ? 'Succeeded' : 'Ready'
  const availableLabel = isJob ? 'Active' : 'Available'
  const updatedLabel = isJob ? 'Failed' : target.kind === 'ReplicaSet' ? 'Current' : 'Updated'
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
        eyebrow={`${summary.kind} health`}
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
            ? `${String(summary.available)} active · ${String(summary.updated)} failed attempts`
            : `${String(summary.available)} available · ${String(summary.updated)} updated · ${summary.update} strategy`
        }
        facts={[
          { label: readyLabel, value: `${String(summary.ready)} / ${String(summary.desired)}` },
          {
            label: availableLabel,
            value: String(summary.available),
            detail: `${String(summary.desired)} desired`,
          },
          {
            label: updatedLabel,
            value: String(summary.updated),
            detail: isJob
              ? 'controller attempts'
              : target.kind === 'ReplicaSet'
                ? 'observed replicas'
                : 'current revision',
          },
          { label: 'Strategy', value: summary.update, detail: `generation ${generationText}` },
          { label: 'Age', value: summary.createdAt ? <Age value={summary.createdAt} /> : '-' },
          {
            label: 'Namespace',
            value: <span className="text-zViolet-accent">{summary.namespace}</span>,
          },
        ]}
      />

      <OperationsGrid>
        {target.namespace && (
          <OperationsPanel
            title="Live Pods"
            description="Pods currently matching this workload selector"
            meta={summary.selector.length > 0 ? 'selector matched' : undefined}
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
          title={isJob ? 'Run progress' : 'Rollout convergence'}
          description={
            isJob ? 'Completions and controller activity' : 'Desired state against observed state'
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
              Conditions
            </div>
            <OverviewChipList chips={summary.conditions} empty="No conditions reported" />
          </div>
        </OperationsPanel>

        <OperationsPanel
          title="Pod template containers"
          description="Container settings used when this workload creates Pods"
          meta={`${String(topology.containers.length)} containers`}
          icon={<GitCompareArrows className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-7"
        >
          <ContainerSpecCards containers={topology.containers} />
        </OperationsPanel>

        <OperationsPanel
          title="Dependencies"
          description="Configuration, storage and runtime references"
          meta={`${String(topology.relations.length)} references`}
          icon={<Cable className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-5"
        >
          <ConnectedResources relations={topology.relations} onNavigate={onNavigate} />
        </OperationsPanel>

        <OperationsPanel
          title="Pod template storage routes"
          description="Volume source → template container mount path"
          meta={`${String(topology.volumes.length)} volumes`}
          icon={<HardDrive className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-7"
        >
          <VolumeMap topology={topology} namespace={target.namespace} onNavigate={onNavigate} />
        </OperationsPanel>

        <OperationsPanel
          title="Workload identity"
          description="Selection, revision and API metadata"
          icon={<Tags className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-5"
          bodyClassName="p-4 @2xl:p-5"
        >
          <div className="px-0.5">
            <FactRow label="Revision" value={summary.revision ?? '-'} mono />
            <FactRow label="Generation" value={generationText} mono />
            <FactRow label="Service account" value={summary.serviceAccount} />
            <FactRow label="API" value={`${summary.apiVersion} · ${summary.kind}`} />
          </div>
          <div className="mt-4 border-t border-zGray-800 pt-4">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-tertiary">
              Selector
            </div>
            <OverviewChipList chips={summary.selector} />
          </div>
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-tertiary">
              Template labels
            </div>
            <OverviewChipList chips={summary.templateLabels} />
          </div>
        </OperationsPanel>

        {target.namespace && hasEditableWorkloadEnv(target.kind) && (
          <OperationsPanel
            title="Pod template environment"
            description="Container-scoped values copied into newly created Pods"
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
