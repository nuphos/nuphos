import { useEffect, useState } from 'react'

import { api } from '../api'
import { LeafDetailPanel } from '../components/LeafDetailPanel'
import { useReportLoading } from '../components/useReportLoading'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { useResetOnKey } from './useResetOnKey'
import { applyFilter } from './zeabur/filter'
import { ErrorBlock, ResourceTable } from './zeabur/shared'

import type { ZeaburProject, ZeaburServer } from '../types'
import type { CommonProps } from './zeabur/shared'

export function ZeaburProjectsView({
  teamId,
  zeaburId,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps) {
  const [items, setItems] = useState<ZeaburProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ZeaburProject | null>(null)
  const { pollTick } = useWorkspaceTab()

  useReportLoading(loading, onLoading)

  useResetOnKey(`${teamId}|${zeaburId}`, () => setSelected(null))
  useResetOnKey(`${teamId}|${zeaburId}|${String(refreshKey)}|${String(pollTick)}`, () => {
    setLoading(true)
    setError(null)
  })

  useEffect(() => {
    let cancelled = false

    api
      .atlasListZeaburProjects(teamId, zeaburId)
      .then((res) => {
        if (cancelled) return
        setItems(res)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setItems([])
        setError(String(e instanceof Error ? e.message : e))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, zeaburId, refreshKey, pollTick])

  const filtered = applyFilter(
    items,
    filter,
    (item) => `${item.name} ${item.id} ${item.region ?? ''} ${item.status ?? ''}`,
  )

  useEffect(() => {
    onCount(error ? 0 : filtered.length)
  }, [error, filtered.length, onCount])

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      <ResourceTable
        loading={loading}
        rows={filtered}
        storageKey="zeabur.projects"
        onSelect={setSelected}
      />
      {selected && (
        <LeafDetailPanel
          open
          onClose={() => setSelected(null)}
          title={selected.name}
          fields={[
            { label: 'ID', value: selected.id, mono: true },
            { label: 'Region', value: selected.region ?? '-' },
            { label: 'Status', value: selected.status ?? '-' },
            { label: 'Created', value: selected.createdAt ?? '-' },
          ]}
        />
      )}
    </>
  )
}

export function ZeaburServersView({
  teamId,
  zeaburId,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps) {
  const [items, setItems] = useState<ZeaburServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ZeaburServer | null>(null)
  const { pollTick } = useWorkspaceTab()

  useReportLoading(loading, onLoading)

  useResetOnKey(`${teamId}|${zeaburId}`, () => setSelected(null))
  useResetOnKey(`${teamId}|${zeaburId}|${String(refreshKey)}|${String(pollTick)}`, () => {
    setLoading(true)
    setError(null)
  })

  useEffect(() => {
    let cancelled = false

    api
      .atlasListZeaburServers(teamId, zeaburId)
      .then((res) => {
        if (cancelled) return
        setItems(res)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setItems([])
        setError(String(e instanceof Error ? e.message : e))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, zeaburId, refreshKey, pollTick])

  const filtered = applyFilter(
    items,
    filter,
    (item) => `${item.name} ${item.id} ${item.region ?? ''} ${item.status ?? ''}`,
  )

  useEffect(() => {
    onCount(error ? 0 : filtered.length)
  }, [error, filtered.length, onCount])

  const formatUnits = (
    used: number | null | undefined,
    total: number | null | undefined,
    suffix: string,
  ) => {
    if (used == null && total == null) return '-'
    if (used == null) return `${String(total)} ${suffix}`
    if (total == null) return `${String(used)} ${suffix}`

    return `${String(used)} / ${String(total)} ${suffix}`
  }

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      <ResourceTable
        loading={loading}
        rows={filtered}
        storageKey="zeabur.servers"
        onSelect={setSelected}
      />
      {selected && (
        <LeafDetailPanel
          open
          onClose={() => setSelected(null)}
          title={selected.name}
          fields={[
            { label: 'ID', value: selected.id, mono: true },
            { label: 'IP', value: selected.ip ?? '-' },
            { label: 'Region', value: selected.region ?? '-' },
            { label: 'Status', value: selected.status ?? '-' },
            { label: 'VM status', value: selected.vmStatus ?? '-' },
            { label: 'Online', value: selected.isOnline == null ? '-' : String(selected.isOnline) },
            {
              label: 'SSH available',
              value: selected.sshAvailable == null ? '-' : String(selected.sshAvailable),
            },
            { label: 'SSH port', value: selected.sshPort == null ? '-' : String(selected.sshPort) },
            { label: 'SSH user', value: selected.sshUsername ?? '-' },
            {
              label: 'Latency',
              value: selected.latency == null ? '-' : `${String(selected.latency)} ms`,
            },
            { label: 'CPU', value: formatUnits(selected.usedCPU, selected.totalCPU, 'm') },
            {
              label: 'Memory',
              value: formatUnits(selected.usedMemory, selected.totalMemory, 'MiB'),
            },
            { label: 'Disk', value: formatUnits(selected.usedDisk, selected.totalDisk, 'MiB') },
            {
              label: 'Warnings',
              value: selected.warnings?.length ? selected.warnings.join('\n') : '-',
            },
            { label: 'Created', value: selected.createdAt ?? '-' },
          ]}
        />
      )}
    </>
  )
}
