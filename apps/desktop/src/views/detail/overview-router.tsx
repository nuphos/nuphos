import { CronJobOverview } from './cronjob-overview'
import { GenericOverview } from './generic-overview'
import { NodeOverview } from './node-overview'
import { PodOverview } from './pod-overview'
import { PvOverview, PvcOverview } from './storage-overview'
import { detailTargetKey } from './target'
import { WorkloadOverview } from './workload-overview'

import type { DetailTarget } from './target'

// Renders the Overview tab body for the current target kind. Pulled out of
// DetailView verbatim; `context` only feeds the remount keys below.
export function OverviewTabContent({
  target,
  context,
  refreshKey,
  hasMatchedPods,
  onNavigate,
}: {
  target: DetailTarget
  context: string
  refreshKey: number
  hasMatchedPods: boolean
  onNavigate?: (target: DetailTarget) => void
}) {
  return target.kind === 'Pod' ? (
    // Keyed like the other detail overviews: without it the first frame
    // after switching Pods draws the previous Pod's data — now
    // including its env values — under the new Pod's header.
    <PodOverview
      key={`${context}\0${detailTargetKey(target)}`}
      namespace={target.namespace!}
      name={target.name}
      refreshKey={refreshKey}
      onNavigate={onNavigate}
    />
  ) : target.kind === 'Node' ? (
    // Keyed so switching node/context remounts instead of reusing
    // state — the first frame never shows the previous node's data,
    // and the useState cache seed below runs per node.
    <NodeOverview
      key={`${context}|${target.name}`}
      name={target.name}
      refreshKey={refreshKey}
      onNavigate={onNavigate}
    />
  ) : target.kind === 'CronJob' ? (
    <CronJobOverview
      namespace={target.namespace!}
      name={target.name}
      refreshKey={refreshKey}
      onNavigate={onNavigate}
    />
  ) : target.kind === 'PersistentVolumeClaim' ? (
    <PvcOverview
      key={`${context}\0${detailTargetKey(target)}`}
      target={target}
      refreshKey={refreshKey}
      onNavigate={onNavigate}
    />
  ) : target.kind === 'PersistentVolume' ? (
    <PvOverview
      key={`${context}\0${detailTargetKey(target)}`}
      target={target}
      refreshKey={refreshKey}
      onNavigate={onNavigate}
    />
  ) : hasMatchedPods ? (
    <WorkloadOverview target={target} refreshKey={refreshKey} onNavigate={onNavigate} />
  ) : (
    <GenericOverview target={target} refreshKey={refreshKey} onNavigate={onNavigate} />
  )
}
