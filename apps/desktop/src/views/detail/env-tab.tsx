import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { Table } from '../../components/Table'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { readSwrCache, writeSwrCache } from '../../lib/swrCache'
import { useResetOnKey } from '../useResetOnKey'

import { buildEnvColumns } from './env-columns'
import { createEnvColumnsContext } from './env-columns-context'
import {
  buildEnvFromTableRows,
  buildEnvTableRows,
  computeDirtyKeys,
  draftsForContainers,
  mergeReloadedDrafts,
  pickSelectedKey,
  unknownEnvEntriesFor,
  unknownEnvFromEntriesFor,
  unsavedStatusText,
} from './env-draft-helpers'
import { buildEnvFromColumns } from './env-from-columns'
import {
  deploymentEnvContainerKey,
  newEnvFromRow,
  newEnvRow,
  normalizedEnvDraft,
} from './env-model'
import { EnvTabHeader } from './env-tab-header'
import { validateEnvDraft } from './env-validate'

import type { ContainerEnvDraft, EnvEditingCell } from './env-model'
import type { DetailTarget } from './target'
import type { EditableWorkloadEnvKind } from './workload-summary'
import type { ConfigMapItem, DeploymentEnvContainer, SecretItem } from '../../types'

export function DeploymentEnvTab({
  kind = 'Deployment',
  namespace,
  name,
  onNavigate,
  embedded = false,
}: {
  kind?: EditableWorkloadEnvKind
  namespace: string
  name: string
  onNavigate?: (target: DetailTarget) => void
  embedded?: boolean
}) {
  const context = useRequiredKubeContext()
  const cacheKey = `workload-env:${context}\0${kind}\0${namespace}\0${name}`
  const initialContainers = readSwrCache<DeploymentEnvContainer[]>(cacheKey) ?? null
  const [containers, setContainers] = useState<DeploymentEnvContainer[] | null>(initialContainers)
  const [selectedKey, setSelectedKey] = useState<string | null>(() =>
    initialContainers?.[0] ? deploymentEnvContainerKey(initialContainers[0]) : null,
  )
  const [drafts, setDrafts] = useState<Record<string, ContainerEnvDraft>>(() =>
    initialContainers ? draftsForContainers(initialContainers) : {},
  )
  const [configMaps, setConfigMaps] = useState<ConfigMapItem[]>([])
  const [secrets, setSecrets] = useState<SecretItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<EnvEditingCell | null>(null)

  async function reload(preferredKey?: string | null) {
    setActionError(null)
    setActionNotice(null)
    const detail = await api.getDeploymentEnv(context, kind, namespace, name)
    const nextDrafts = draftsForContainers(detail.containers)

    writeSwrCache(cacheKey, detail.containers)
    setContainers(detail.containers)
    setDrafts((current) =>
      mergeReloadedDrafts(current, detail.containers, nextDrafts, preferredKey),
    )
    const keys = detail.containers.map(deploymentEnvContainerKey)

    setSelectedKey((current) => pickSelectedKey(current, keys, preferredKey))
  }

  useResetOnKey(cacheKey, () => {
    const cached = readSwrCache<DeploymentEnvContainer[]>(cacheKey) ?? null

    setContainers(cached)
    setSelectedKey(cached?.[0] ? deploymentEnvContainerKey(cached[0]) : null)
    setDrafts(cached ? draftsForContainers(cached) : {})
    setError(null)
    setActionError(null)
    setActionNotice(null)
    setSavingKey(null)
    setEditingCell(null)
  })

  useEffect(() => {
    let cancelled = false
    const cached = readSwrCache<DeploymentEnvContainer[]>(cacheKey)

    api
      .getDeploymentEnv(context, kind, namespace, name)
      .then((detail) => {
        if (cancelled) return
        writeSwrCache(cacheKey, detail.containers)
        setContainers(detail.containers)
        setDrafts(draftsForContainers(detail.containers))
        setSelectedKey(
          detail.containers[0] ? deploymentEnvContainerKey(detail.containers[0]) : null,
        )
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (cached) {
          console.warn('[workload-env] refresh failed; keeping cached data:', String(e))
        } else {
          setError(String(e instanceof Error ? e.message : e))
        }
      })

    return () => {
      cancelled = true
    }
  }, [cacheKey, context, kind, namespace, name])

  useResetOnKey(selectedKey ?? '', () => {
    setEditingCell(null)
  })

  useResetOnKey(`${context}\0${namespace}`, () => {
    setConfigMaps([])
    setSecrets([])
  })

  useEffect(() => {
    let cancelled = false

    Promise.all([api.listConfigMaps(context, namespace), api.listSecrets(context, namespace)])
      .then(([nextConfigMaps, nextSecrets]) => {
        if (cancelled) return
        setConfigMaps(nextConfigMaps)
        setSecrets(nextSecrets)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setActionNotice(
          `Could not load ConfigMap/Secret choices: ${String(e instanceof Error ? e.message : e)}`,
        )
      })

    return () => {
      cancelled = true
    }
  }, [context, namespace])

  const selectedContainer = useMemo(
    () =>
      containers?.find((container) => deploymentEnvContainerKey(container) === selectedKey) ?? null,
    [containers, selectedKey],
  )
  const selectedDraft = selectedKey
    ? (drafts[selectedKey] ?? { env: [], envFrom: [] })
    : { env: [], envFrom: [] }
  const dirtyKeys = useMemo(() => computeDirtyKeys(containers, drafts), [containers, drafts])
  const changed = selectedKey ? dirtyKeys.has(selectedKey) : false
  const unsavedStatus = unsavedStatusText(changed, dirtyKeys.size)
  const unknownEnvEntries = unknownEnvEntriesFor(selectedContainer)
  const unknownEnvFromEntries = unknownEnvFromEntriesFor(selectedContainer)
  const envRows = buildEnvTableRows(selectedDraft, unknownEnvEntries)
  const envFromRows = buildEnvFromTableRows(selectedDraft, unknownEnvFromEntries)
  const columnsCtx = createEnvColumnsContext({
    namespace,
    onNavigate,
    configMaps,
    secrets,
    selectedKey,
    selectedDraft,
    editingCell,
    setEditingCell,
    setDrafts,
  })
  const { updateDraft } = columnsCtx
  const envColumns = buildEnvColumns(columnsCtx)
  const envFromColumns = buildEnvFromColumns(columnsCtx)

  async function saveSelected() {
    if (!selectedContainer || !selectedKey) return
    const validationError = validateEnvDraft(
      selectedDraft,
      unknownEnvEntries.map((entry) => entry.name),
    )

    if (validationError) {
      setActionError(validationError)

      return
    }
    setSavingKey(selectedKey)
    setActionError(null)
    setActionNotice(null)
    try {
      await api.updateDeploymentContainerEnv(
        context,
        kind,
        namespace,
        name,
        selectedContainer.type,
        selectedContainer.name,
        normalizedEnvDraft(selectedDraft),
      )
    } catch (e) {
      setActionError(String(e instanceof Error ? e.message : e))
      setSavingKey(null)

      return
    }
    setSavingKey(null)
    try {
      await reload(selectedKey)
    } catch {
      setActionNotice(
        'Saved, but could not refresh the environment list. Refresh to see the latest values.',
      )
    }
  }

  if (error) return <div className="p-6 text-error text-[13px]">{error}</div>
  if (!containers) return <div className="p-6 text-tertiary text-[13px]">Loading…</div>
  if (!selectedContainer || !selectedKey) {
    return <div className="p-6 text-tertiary text-[13px]">No containers.</div>
  }

  return (
    <div className={clsx('flex flex-col', !embedded && 'min-h-full bg-zGray-950')}>
      <EnvTabHeader
        containers={containers}
        selectedKey={selectedKey}
        dirtyKeys={dirtyKeys}
        unsavedStatus={unsavedStatus}
        embedded={embedded}
        saving={savingKey === selectedKey}
        changed={changed}
        onSelect={setSelectedKey}
        onAddEnv={() => {
          const row = newEnvRow()

          updateDraft(selectedKey, { ...selectedDraft, env: [...selectedDraft.env, row] })
          setEditingCell({ table: 'env', rowId: row.id, column: 'name' })
        }}
        onAddEnvFrom={() => {
          const row = newEnvFromRow()

          updateDraft(selectedKey, {
            ...selectedDraft,
            envFrom: [...selectedDraft.envFrom, row],
          })
          setEditingCell({ table: 'envFrom', rowId: row.id, column: 'name' })
        }}
        onSave={() => void saveSelected()}
      />
      {actionError && (
        <div className="border-b border-error/20 bg-error/10 px-6 py-2 text-[12.5px] text-error">
          {actionError}
        </div>
      )}
      {actionNotice && (
        <div className="border-b border-zGray-800 bg-zGray-900 px-6 py-2 text-[12.5px] text-secondary">
          {actionNotice}
        </div>
      )}
      <div className={embedded ? '' : 'p-6'}>
        <div className="mb-6 min-h-[180px]">
          <Table
            columns={envColumns}
            rows={envRows}
            rowKey={(row) => (row.kind === 'editable' ? row.row.id : row.id)}
            storageKey={`${kind.toLowerCase()}.env`}
            empty="No environment variables."
          />
        </div>
        <div className="min-h-[160px] border-t border-zGray-800">
          <Table
            columns={envFromColumns}
            rows={envFromRows}
            rowKey={(row) => (row.kind === 'editable' ? row.row.id : row.id)}
            storageKey={`${kind.toLowerCase()}.envFrom`}
            empty="No envFrom sources."
          />
        </div>
      </div>
    </div>
  )
}
