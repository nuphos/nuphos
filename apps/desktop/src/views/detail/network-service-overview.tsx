import { ArrowUpRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'

import { Field, Section } from './shared'

import type { DetailTarget } from './target'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {}
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, fallback = '-'): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

export function ServiceOverview({
  target,
  spec,
  namespace,
  onNavigate,
}: {
  target: DetailTarget
  spec: UnknownRecord
  namespace: string | null
  onNavigate?: (target: DetailTarget) => void
}) {
  const context = useRequiredKubeContext()
  const [sliceNames, setSliceNames] = useState<string[]>([])

  useEffect(() => {
    if (!namespace) return
    let cancelled = false

    api
      .listEndpointSlices(context, namespace)
      .then((slices) => {
        if (!cancelled) {
          setSliceNames(
            slices.filter((slice) => slice.service_name === target.name).map((slice) => slice.name),
          )
        }
      })
      .catch(() => {
        if (!cancelled) setSliceNames([])
      })

    return () => {
      cancelled = true
    }
  }, [context, namespace, target.name])

  return (
    <div className="space-y-5 p-6">
      <Section>
        <Field label="Type" value={text(spec.type, 'ClusterIP')} />
        <Field label="Cluster IP" value={text(spec.clusterIP)} />
        <Field label="Selector" value={JSON.stringify(record(spec.selector))} />
        <Field label="Traffic policy" value={text(spec.externalTrafficPolicy)} />
      </Section>
      <div>
        <div className="mb-2 text-[11.5px] uppercase tracking-wider text-tertiary">
          Endpoint slices
        </div>
        <div className="flex flex-wrap gap-2">
          {sliceNames.length > 0
            ? sliceNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={!onNavigate}
                  onClick={() => onNavigate?.({ kind: 'EndpointSlice', namespace, name })}
                  className="inline-flex items-center gap-1 font-mono text-zViolet-accent disabled:text-secondary"
                >
                  EndpointSlice/{name}
                  {onNavigate && <ArrowUpRight className="h-3 w-3" />}
                </button>
              ))
            : '-'}
        </div>
      </div>
      <div>
        <div className="mb-2 text-[11.5px] uppercase tracking-wider text-tertiary">Ports</div>
        <div className="divide-y divide-zGray-800 rounded-md border border-zGray-800">
          {records(spec.ports).map((port, index) => (
            <div key={String(index)} className="grid grid-cols-4 gap-3 px-4 py-3 text-[12.5px]">
              <Field label="Name" value={text(port.name)} />
              <Field label="Port" value={text(port.port)} />
              <Field label="Target port" value={text(port.targetPort)} />
              <Field label="Protocol" value={text(port.protocol, 'TCP')} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
