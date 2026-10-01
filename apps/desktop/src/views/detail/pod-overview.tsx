/* eslint-disable max-lines -- the operational overview keeps its full visual hierarchy together. */
import {
  ArrowUpRight,
  Box,
  Cable,
  HardDrive,
  Network,
  Server,
  SlidersHorizontal,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { PodStatus } from '../../components/K8sHealth'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { podTone } from '../../lib/k8sHealth'
import { readSwrCache, writeSwrCache } from '../../lib/swrCache'
import { useResetOnKey } from '../useResetOnKey'

import {
  FactRow,
  OperationsCanvas,
  OperationsGrid,
  OperationsHero,
  OperationsPanel,
} from './operations-layout'
import { PodEnvSection } from './pod-env-section'
import { allPodContainers, containerDisplayName } from './pod-containers'
import { parseResourceTopology } from './resource-topology'
import { ConnectedResources, VolumeMap } from './resource-topology-section'
import { ContainerCard, OverviewChipList } from './shared'

import type { DetailTarget } from './target'
import type { HealthTone } from '../../lib/k8sHealth'
import type { PodConditionDetail, PodDetail } from '../../types'

type PodOverviewSnapshot = { data: PodDetail; yamlText: string }

function podHealthTitle(tone: HealthTone, status: string) {
  if (tone === 'success') return 'Healthy and ready'
  if (tone === 'error') return 'Needs attention'
  if (tone === 'warning') return 'Still converging'

  return status || 'Inactive'
}

function conditionTone(condition: PodConditionDetail, podHealth: HealthTone): HealthTone {
  if (condition.status === 'True') return 'success'
  if (podHealth === 'neutral') return 'neutral'
  if (condition.status === 'Unknown') return 'warning'
  if (podHealth === 'error') return 'error'

  return 'warning'
}

function navigableOwnerKind(kind: string | null): DetailTarget['kind'] | null {
  if (
    kind === 'Deployment' ||
    kind === 'ReplicaSet' ||
    kind === 'StatefulSet' ||
    kind === 'DaemonSet' ||
    kind === 'Job' ||
    kind === 'CronJob'
  ) {
    return kind
  }

  return null
}

function RelatedResourceButton({
  kind,
  namespace,
  name,
  onNavigate,
}: {
  kind: DetailTarget['kind']
  namespace: string | null
  name: string
  onNavigate?: (target: DetailTarget) => void
}) {
  if (!onNavigate) return <>{name}</>

  return (
    <button
      type="button"
      onClick={() => onNavigate({ kind, namespace, name })}
      className="group inline-flex max-w-full items-center gap-1 hover:text-zViolet-accent"
      title={`Open ${kind} ${name}`}
    >
      <span className="truncate">{name}</span>
      <ArrowUpRight className="h-3 w-3 shrink-0 opacity-60" />
    </button>
  )
}

export function PodOverview({
  namespace,
  name,
  refreshKey,
  onNavigate,
}: {
  namespace: string
  name: string
  refreshKey: number
  onNavigate?: (target: DetailTarget) => void
}) {
  const context = useRequiredKubeContext()
  const cacheKey = `pod-overview:${context}\0${namespace}\0${name}`
  const [snapshot, setSnapshot] = useState<PodOverviewSnapshot | null>(
    () => readSwrCache<PodOverviewSnapshot>(cacheKey) ?? null,
  )
  const [error, setError] = useState<string | null>(null)
  const [selectedContainerName, setSelectedContainerName] = useState<string | null>(null)

  useResetOnKey(cacheKey, () => {
    setSnapshot(readSwrCache<PodOverviewSnapshot>(cacheKey) ?? null)
    setError(null)
    setSelectedContainerName(null)
  })

  useEffect(() => {
    let cancelled = false
    const cached = readSwrCache<PodOverviewSnapshot>(cacheKey)

    Promise.all([
      api.getPodDetail(context, namespace, name),
      api.getResourceYaml(context, 'Pod', namespace, name),
    ])
      .then(([data, yamlText]) => {
        if (cancelled) return
        const next = { data, yamlText }

        writeSwrCache(cacheKey, next)
        setError(null)
        setSnapshot(next)
      })
      .catch((e: unknown) => {
        if (cancelled || cached) return
        setError(String(e instanceof Error ? e.message : e))
      })

    return () => {
      cancelled = true
    }
  }, [cacheKey, context, namespace, name, refreshKey])

  if (error) return <div className="p-6 text-error text-[13px]">{error}</div>
  if (!snapshot) return <div className="p-6 text-tertiary text-[13px]">Loading…</div>

  const { data, yamlText } = snapshot
  const topology = parseResourceTopology(yamlText, { kind: 'Pod', namespace, name })
  const allContainers = allPodContainers(data)
  const selectedContainer = allContainers.find(
    (container) => container.name === selectedContainerName,
  )
  const selectedContainerTopology = topology.containers.find(
    (container) =>
      container.name === selectedContainer?.name &&
      container.init === selectedContainer?.is_init &&
      container.ephemeral === selectedContainer?.is_ephemeral,
  )
  const ready =
    data.ready ??
    `${String(data.containers.filter((container) => container.ready).length)}/${String(data.containers.length)}`
  const restarts = allContainers.reduce((total, container) => total + container.restarts, 0)
  const tone = podTone(data.status, ready)
  const ownerKind = navigableOwnerKind(data.owner_kind)

  return (
    <OperationsCanvas>
      <OperationsHero
        eyebrow="Runtime health"
        title={podHealthTitle(tone, data.status)}
        tone={tone}
        badge={<PodStatus status={data.status} ready={ready} />}
        description={
          <>
            {ready} application containers ready
            <span className="px-1.5 text-tertiary">·</span>
            {restarts === 0 ? 'No restarts recorded' : `${String(restarts)} restarts need review`}
          </>
        }
        facts={[
          {
            label: 'Ready',
            value: ready,
            detail: `${String(data.containers.length)} app containers`,
          },
          {
            label: 'Restarts',
            value: <span className={restarts > 0 ? 'text-warning' : undefined}>{restarts}</span>,
            detail: 'across all containers',
          },
          { label: 'Age', value: data.age ? <Age value={data.age} /> : '-' },
          {
            label: 'Node',
            value: data.node ? (
              <RelatedResourceButton
                kind="Node"
                namespace={null}
                name={data.node}
                onNavigate={onNavigate}
              />
            ) : (
              '-'
            ),
            detail: 'scheduled host',
          },
          { label: 'Pod IP', value: data.pod_ip ?? '-', detail: data.host_ip ?? undefined },
          { label: 'QoS', value: data.qos ?? '-', detail: data.phase },
        ]}
      />

      <OperationsGrid>
        <OperationsPanel
          title="Live containers"
          description="Current state, restarts and resource contract"
          meta={`${String(data.containers.length)} app · ${String(data.init_containers.length)} init · ${String(data.ephemeral_containers.length)} ephemeral`}
          icon={<Box className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-8"
          bodyClassName="grid grid-cols-1 gap-3 p-3 @2xl:grid-cols-2 @2xl:p-4"
        >
          {allContainers.map((container) => (
            <ContainerCard
              key={`${container.is_init ? 'init' : container.is_ephemeral ? 'ephemeral' : 'app'}:${container.name}`}
              c={container}
              selected={selectedContainer?.name === container.name}
              onSelect={() => setSelectedContainerName(container.name)}
            />
          ))}
        </OperationsPanel>

        <OperationsPanel
          title="Placement"
          description="Where this runtime landed"
          icon={<Server className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-4"
          bodyClassName="px-4 py-1.5 @2xl:px-5"
        >
          <FactRow
            label="Node"
            value={
              data.node ? (
                <RelatedResourceButton
                  kind="Node"
                  namespace={null}
                  name={data.node}
                  onNavigate={onNavigate}
                />
              ) : (
                '-'
              )
            }
          />
          <FactRow label="Pod IP" value={data.pod_ip ?? '-'} mono />
          <FactRow label="Host IP" value={data.host_ip ?? '-'} mono />
          <FactRow
            label="Service account"
            value={
              data.service_account ? (
                <RelatedResourceButton
                  kind="ServiceAccount"
                  namespace={namespace}
                  name={data.service_account}
                  onNavigate={onNavigate}
                />
              ) : (
                '-'
              )
            }
          />
          <FactRow
            label="Owner"
            value={
              ownerKind && data.owner_name ? (
                <RelatedResourceButton
                  kind={ownerKind}
                  namespace={namespace}
                  name={data.owner_name}
                  onNavigate={onNavigate}
                />
              ) : (
                (data.owner_name ?? '-')
              )
            }
          />
          <FactRow
            label="Started"
            value={data.start_time ? <Age value={data.start_time} /> : '-'}
          />
        </OperationsPanel>

        {selectedContainer && (
          <OperationsPanel
            title={containerDisplayName(selectedContainer)}
            description="Environment and volume mounts for this container"
            icon={<SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />}
            className="@5xl:col-span-7"
            bodyClassName="space-y-5 p-3 @2xl:p-4"
          >
            <div>
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-tertiary">
                Environment
              </div>
              <PodEnvSection
                namespace={data.namespace || namespace}
                containers={[selectedContainer]}
                onNavigate={onNavigate}
                embedded
              />
            </div>
            <div>
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-tertiary">
                Volume mounts
              </div>
              {selectedContainerTopology?.mounts.length ? (
                <div className="space-y-1.5">
                  {selectedContainerTopology.mounts.map((mount) => (
                    <div
                      key={`${mount.volumeName}:${mount.path}`}
                      className="flex min-w-0 items-center gap-2 rounded bg-zGray-900 px-2.5 py-2 font-mono text-[11.5px]"
                    >
                      <span className="truncate text-main">{mount.path}</span>
                      <span className="text-tertiary">←</span>
                      <span className="truncate text-secondary">{mount.volumeName}</span>
                      {mount.readOnly && <span className="text-tertiary">read-only</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-tertiary">No volumes mounted.</div>
              )}
            </div>
          </OperationsPanel>
        )}

        <OperationsPanel
          title="Dependencies"
          description="Configuration, storage and runtime references"
          meta={`${String(topology.relations.length)} references`}
          icon={<Cable className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className={selectedContainer ? '@5xl:col-span-5' : '@5xl:col-span-12'}
        >
          <ConnectedResources relations={topology.relations} onNavigate={onNavigate} />
        </OperationsPanel>

        <OperationsPanel
          title="Storage routes"
          description="Source → volume → container mount path"
          meta={`${String(topology.volumes.length)} volumes`}
          icon={<HardDrive className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-8"
        >
          <VolumeMap topology={topology} namespace={namespace} onNavigate={onNavigate} />
        </OperationsPanel>

        <OperationsPanel
          title="Scheduling signals"
          description="Conditions and placement constraints"
          icon={<Network className="h-3.5 w-3.5" strokeWidth={1.8} />}
          className="@5xl:col-span-4"
          bodyClassName="space-y-5 p-4 @2xl:p-5"
        >
          <div>
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-tertiary">
              Conditions
            </div>
            <OverviewChipList
              chips={data.conditions.map((condition) => ({
                label: `${condition.type}: ${condition.status}`,
                title:
                  [condition.reason, condition.message].filter(Boolean).join(' — ') ||
                  `${condition.type}: ${condition.status}`,
                tone: conditionTone(condition, tone),
              }))}
              empty="No active conditions"
            />
          </div>
          <div>
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-tertiary">
              Tolerations
            </div>
            <OverviewChipList
              chips={data.tolerations.map((toleration) => ({
                label: `${toleration.key}: ${toleration.effect}`,
              }))}
              empty="No tolerations"
            />
          </div>
          <div>
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-tertiary">
              Labels
            </div>
            <OverviewChipList
              chips={data.labels.map(([key, value]) => ({
                label: `${key}: ${value}`,
                title: `${key}: ${value}`,
              }))}
            />
          </div>
        </OperationsPanel>
      </OperationsGrid>
    </OperationsCanvas>
  )
}
