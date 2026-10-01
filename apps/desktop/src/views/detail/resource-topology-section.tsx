import {
  ArrowUpRight,
  Boxes,
  Database,
  FileKey2,
  HardDrive,
  KeyRound,
  Server,
  ShieldCheck,
} from 'lucide-react'

import type {
  NavigableResourceKind,
  ResourceRelation,
  ResourceTopology,
  VolumeSourceModel,
} from './resource-topology'
import type { DetailTarget } from './target'

const relationGroups = ['Configuration', 'Storage', 'Runtime'] as const

function ResourceKindIcon({ kind }: { kind: NavigableResourceKind }) {
  if (kind === 'Secret') return <KeyRound className="h-3.5 w-3.5" strokeWidth={1.8} />
  if (kind === 'ConfigMap') return <FileKey2 className="h-3.5 w-3.5" strokeWidth={1.8} />
  if (kind === 'PersistentVolumeClaim')
    return <HardDrive className="h-3.5 w-3.5" strokeWidth={1.8} />
  if (kind === 'Node') return <Server className="h-3.5 w-3.5" strokeWidth={1.8} />
  if (kind === 'ServiceAccount') return <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
  if (kind === 'Service') return <Database className="h-3.5 w-3.5" strokeWidth={1.8} />

  return <Boxes className="h-3.5 w-3.5" strokeWidth={1.8} />
}

function ResourceLink({
  relation,
  usageCount = 1,
  usageTitle,
  onNavigate,
}: {
  relation: ResourceRelation
  usageCount?: number
  usageTitle?: string
  onNavigate?: (target: DetailTarget) => void
}) {
  return (
    <button
      type="button"
      disabled={!onNavigate}
      onClick={() =>
        onNavigate?.({
          kind: relation.kind,
          namespace: relation.namespace,
          name: relation.name,
        })
      }
      className="group flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-zGray-850 disabled:pointer-events-none"
      title={usageTitle ?? `Open ${relation.kind} ${relation.name}`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zViolet-500/10 text-zViolet-accent ring-1 ring-inset ring-zViolet-500/15">
        <ResourceKindIcon kind={relation.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[12.5px] font-medium text-main group-hover:text-zViolet-accent">
            {relation.name}
          </span>
          <span className="shrink-0 text-[10.5px] text-tertiary">{relation.kind}</span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-tertiary">
          <span className="truncate">
            {usageCount > 1 ? `${String(usageCount)} references · ${relation.via}` : relation.via}
          </span>
          {relation.detail && (
            <>
              <span className="shrink-0 opacity-50">·</span>
              <span className="truncate font-mono">{relation.detail}</span>
            </>
          )}
        </span>
      </span>
      {onNavigate && (
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  )
}

function collapseRelations(relations: ResourceRelation[]) {
  const grouped = new Map<string, ResourceRelation[]>()

  for (const relation of relations) {
    const key = `${relation.kind}\0${relation.namespace ?? ''}\0${relation.name}`
    const existing = grouped.get(key)

    if (existing) existing.push(relation)
    else grouped.set(key, [relation])
  }

  return [...grouped.values()]
}

function usageDescription(usage: ResourceRelation) {
  return usage.detail ? `${usage.via} · ${usage.detail}` : usage.via
}

export function ConnectedResources({
  relations,
  onNavigate,
}: {
  relations: ResourceRelation[]
  onNavigate?: (target: DetailTarget) => void
}) {
  if (relations.length === 0) {
    return <div className="px-5 py-4 text-[12px] text-tertiary">No resource references found.</div>
  }

  return (
    <div className="px-3 py-2">
      {relationGroups.map((group) => {
        const groupRelations = collapseRelations(
          relations.filter((relation) => relation.group === group),
        )

        if (groupRelations.length === 0) return null

        return (
          <div key={group} className="py-2">
            <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-tertiary">
              {group}
            </div>
            <div>
              {groupRelations.map((uses) => {
                const relation = uses[0]

                return relation ? (
                  <ResourceLink
                    key={relation.id}
                    relation={relation}
                    usageCount={uses.length}
                    usageTitle={uses.map(usageDescription).join('\n')}
                    onNavigate={onNavigate}
                  />
                ) : null
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SourceLabel({
  source,
  namespace,
  onNavigate,
}: {
  source: VolumeSourceModel
  namespace: string | null
  onNavigate?: (target: DetailTarget) => void
}) {
  const label = (
    <>
      <span className="text-secondary">{source.label}</span>
      {source.name && <span className="truncate font-mono text-main">{source.name}</span>}
      {source.detail && <span className="truncate text-tertiary">{source.detail}</span>}
    </>
  )

  if (!source.kind || !source.name || !onNavigate) {
    return <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">{label}</div>
  }
  const kind = source.kind
  const name = source.name

  return (
    <button
      type="button"
      onClick={() => onNavigate({ kind, namespace, name })}
      className="group flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-left hover:text-zViolet-accent"
      title={`Open ${kind} ${name}`}
    >
      {label}
      <ArrowUpRight className="h-3 w-3 shrink-0 text-tertiary group-hover:text-zViolet-accent" />
    </button>
  )
}

export function VolumeMap({
  topology,
  namespace,
  onNavigate,
}: {
  topology: ResourceTopology
  namespace: string | null
  onNavigate?: (target: DetailTarget) => void
}) {
  if (topology.volumes.length === 0) {
    return <div className="px-6 py-5 text-[12px] text-tertiary">No volumes declared.</div>
  }

  return (
    <div className="divide-y divide-zGray-800">
      {topology.volumes.map((volume) => (
        <div
          key={volume.name}
          className="grid min-w-0 grid-cols-1 gap-3 px-6 py-3 @2xl:grid-cols-[180px_minmax(0,1fr)]"
        >
          <div className="flex min-w-0 items-start gap-2">
            <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={1.8} />
            <span
              className="truncate font-mono text-[12px] font-medium text-main"
              title={volume.name}
            >
              {volume.name}
            </span>
          </div>
          <div className="min-w-0 space-y-2 text-[11.5px]">
            <div className="space-y-1">
              {volume.sources.map((source, index) => (
                <SourceLabel
                  key={`${source.label}:${source.name ?? ''}:${String(index)}`}
                  source={source}
                  namespace={namespace}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
            {volume.mounts.length > 0 ? (
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {volume.mounts.map((mount) => (
                  <span
                    key={`${mount.container}:${mount.path}`}
                    className="max-w-full truncate rounded bg-zGray-800 px-1.5 py-0.5 font-mono text-[10.5px] text-secondary"
                    title={`${mount.init ? 'Init container' : mount.ephemeral ? 'Ephemeral container' : 'Container'} ${mount.container}: ${mount.path}${mount.readOnly ? ' (read-only)' : ''}`}
                  >
                    {mount.init ? 'init/' : mount.ephemeral ? 'ephemeral/' : ''}
                    {mount.container} → {mount.path}
                    {mount.readOnly ? ' · ro' : ''}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-warning">
                Declared but not mounted by a container
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
