import clsx from 'clsx'
import { useState } from 'react'

import { Table } from '../../components/Table'

import { EnvRefNavButton } from './env-cells'
import { sourceLabel } from './env-options'
import { readonlyText } from './env-readonly-text'

import type { DetailTarget } from './target'
import type { Column } from '../../components/Table'
import type { ContainerDetail, DeploymentEnvEntry, DeploymentEnvFromEntry } from '../../types'

// Positional row ids: a container spec may legally repeat an env name (the
// last one wins at runtime), so the name alone is not a stable table key.
type PodEnvRow = DeploymentEnvEntry & { id: string }
type PodEnvFromRow = DeploymentEnvFromEntry & { id: string }

// Read-only twin of the workload env editor (DeploymentEnvTab): a running Pod's
// env is immutable, the API server rejects patches to spec.containers[].env.
export function PodEnvSection({
  namespace,
  containers,
  onNavigate,
  embedded = false,
}: {
  namespace: string
  containers: ContainerDetail[]
  onNavigate?: (target: DetailTarget) => void
  embedded?: boolean
}) {
  const withEnv = containers.filter((c) => c.env.length > 0 || c.envFrom.length > 0)
  const [selectedName, setSelectedName] = useState<string | null>(null)

  if (withEnv.length === 0) {
    return embedded ? (
      <div className="py-1 text-[12px] text-tertiary">No environment variables declared.</div>
    ) : null
  }

  const selected = withEnv.find((c) => c.name === selectedName) ?? withEnv[0]

  const envRows: PodEnvRow[] = selected.env.map((entry, index) => ({
    ...entry,
    id: String(index),
  }))
  const envFromRows: PodEnvFromRow[] = selected.envFrom.map((entry, index) => ({
    ...entry,
    id: String(index),
  }))

  const envColumns: Column<PodEnvRow>[] = [
    {
      key: 'name',
      header: 'Name',
      width: 220,
      render: (entry) => readonlyText(entry.name, { mono: true }),
    },
    {
      key: 'source',
      header: 'Source',
      width: 170,
      render: (entry) => readonlyText(sourceLabel(entry.source)),
    },
    {
      key: 'target',
      header: 'Target',
      width: 300,
      render: (entry) => {
        let value = ''

        if (entry.source === 'value') value = entry.value ?? ''
        if (entry.source === 'configMapKeyRef' || entry.source === 'secretKeyRef') {
          value = entry.refName ?? ''
        }
        if (entry.source === 'fieldRef') value = entry.fieldPath ?? ''
        if (entry.source === 'resourceFieldRef') {
          value = [entry.containerName, entry.resource].filter(Boolean).join(' / ')
        }
        if (entry.source === 'fileKeyRef') {
          value = [entry.volumeName, entry.path].filter(Boolean).join(' / ')
        }
        if (entry.source === 'unknown') value = entry.sourceLabel
        const isKeyRef = entry.source === 'configMapKeyRef' || entry.source === 'secretKeyRef'

        return (
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1">
              {readonlyText(value, { mono: true, muted: !value, sensitive: true })}
            </div>
            {isKeyRef && value ? (
              <EnvRefNavButton
                kind={entry.source === 'secretKeyRef' ? 'Secret' : 'ConfigMap'}
                namespace={namespace}
                name={value}
                onNavigate={onNavigate}
              />
            ) : null}
          </div>
        )
      },
    },
    {
      key: 'detail',
      header: 'Detail',
      width: 220,
      render: (entry) => {
        let value = ''

        if (entry.source === 'configMapKeyRef' || entry.source === 'secretKeyRef') {
          value = entry.key ?? ''
        }
        if (entry.source === 'fieldRef') value = entry.apiVersion ?? ''
        if (entry.source === 'resourceFieldRef') value = entry.divisor ?? ''
        if (entry.source === 'fileKeyRef') value = entry.key ?? ''

        return readonlyText(value, { mono: true, muted: !value })
      },
    },
    {
      key: 'optional',
      header: 'Optional',
      width: 100,
      render: (entry) => {
        if (
          entry.source !== 'configMapKeyRef' &&
          entry.source !== 'secretKeyRef' &&
          entry.source !== 'fileKeyRef'
        ) {
          return null
        }

        return readonlyText(entry.optional ? 'Yes' : 'No', { muted: !entry.optional })
      },
    },
  ]

  const envFromColumns: Column<PodEnvFromRow>[] = [
    {
      key: 'source',
      header: 'Source',
      width: 180,
      render: (entry) => readonlyText(sourceLabel(entry.source)),
    },
    {
      key: 'name',
      header: 'Name',
      width: 300,
      render: (entry) => (
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1">
            {readonlyText(entry.name ?? '', { mono: true, muted: !entry.name })}
          </div>
          {entry.name && entry.source !== 'unknown' ? (
            <EnvRefNavButton
              kind={entry.source === 'secretRef' ? 'Secret' : 'ConfigMap'}
              namespace={namespace}
              name={entry.name}
              onNavigate={onNavigate}
            />
          ) : null}
        </div>
      ),
    },
    {
      key: 'prefix',
      header: 'Prefix',
      width: 220,
      render: (entry) => readonlyText(entry.prefix ?? '', { mono: true, muted: !entry.prefix }),
    },
    {
      key: 'optional',
      header: 'Optional',
      width: 100,
      render: (entry) => readonlyText(entry.optional ? 'Yes' : 'No', { muted: !entry.optional }),
    },
  ]

  return (
    <div>
      <div
        className={clsx(
          'flex flex-wrap items-center gap-3',
          (!embedded || withEnv.length > 1) && 'mb-2',
        )}
      >
        {!embedded && (
          <h3 className="text-[14px] font-semibold text-main">Environment Variables</h3>
        )}
        {withEnv.length > 1 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {withEnv.map((container) => {
              const label = `${container.is_init ? 'Init: ' : ''}${container.name}`

              return (
                <button
                  key={container.name}
                  type="button"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    setSelectedName(container.name)
                  }}
                  onClick={(event) => {
                    if (event.detail !== 0) return
                    setSelectedName(container.name)
                  }}
                  className={clsx(
                    'inline-flex h-7 max-w-[220px] items-center rounded px-2.5 text-[12px]',
                    selected.name === container.name
                      ? 'bg-zViolet-500/20 text-zViolet-accent'
                      : 'text-secondary hover:bg-zGray-800 hover:text-main',
                  )}
                  title={container.image}
                >
                  <span className="min-w-0 truncate">{label}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="rounded-md border border-zGray-800 bg-zGray-900">
        <div className="min-h-[120px]">
          <Table
            columns={envColumns}
            rows={envRows}
            rowKey={(entry) => entry.id}
            storageKey="pod.env"
            empty="No environment variables."
          />
        </div>
        {envFromRows.length > 0 && (
          <div className="border-t border-zGray-800">
            <Table
              columns={envFromColumns}
              rows={envFromRows}
              rowKey={(entry) => entry.id}
              storageKey="pod.envFrom"
              empty="No envFrom sources."
            />
          </div>
        )}
      </div>
    </div>
  )
}
