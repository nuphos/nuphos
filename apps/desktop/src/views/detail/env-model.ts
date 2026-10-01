import type {
  DeploymentEnvContainer,
  DeploymentEnvEntryInput,
  DeploymentEnvFromInput,
  DeploymentEnvSource,
  DeploymentEnvUpdateInput,
} from '../../types'

export type EditableDeploymentEnvSource = Exclude<DeploymentEnvSource, 'unknown' | 'fileKeyRef'>

// Sources the editor can describe but not build: they render as read-only rows
// and the main process preserves them on save.
export function isReadOnlyEnvSource(
  source: DeploymentEnvSource,
): source is Exclude<DeploymentEnvSource, EditableDeploymentEnvSource> {
  return source === 'unknown' || source === 'fileKeyRef'
}

export type EnvDraftRow = DeploymentEnvEntryInput & {
  id: string
  source: EditableDeploymentEnvSource
}

export type EnvFromDraftRow = DeploymentEnvFromInput & {
  id: string
  source: 'configMapRef' | 'secretRef'
}

export type ContainerEnvDraft = {
  env: EnvDraftRow[]
  envFrom: EnvFromDraftRow[]
}

export type EnvTableRow =
  | { kind: 'editable'; row: EnvDraftRow }
  | { kind: 'unknown'; entry: DeploymentEnvContainer['env'][number]; id: string }

export type EnvFromTableRow =
  | { kind: 'editable'; row: EnvFromDraftRow }
  | { kind: 'unknown'; entry: DeploymentEnvContainer['envFrom'][number]; id: string }

export type EnvEditingCell =
  | { table: 'env'; rowId: string; column: 'name' | 'source' | 'target' | 'detail' | 'optional' }
  | { table: 'envFrom'; rowId: string; column: 'source' | 'name' | 'prefix' | 'optional' }

export function deploymentEnvContainerKey(container: DeploymentEnvContainer) {
  return `${container.type}/${container.name}`
}

let draftRowSeq = 0

function draftRowNonce(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  return `${Date.now().toString(36)}-${String(draftRowSeq++)}`
}

function envRowId(container: DeploymentEnvContainer, index: number) {
  return `${container.type}:${container.name}:env:${String(index)}:${draftRowNonce()}`
}

function envFromRowId(container: DeploymentEnvContainer, index: number) {
  return `${container.type}:${container.name}:envFrom:${String(index)}:${draftRowNonce()}`
}

export function newEnvRow(): EnvDraftRow {
  return {
    id: `new-env:${draftRowNonce()}`,
    name: '',
    source: 'value',
    value: '',
    optional: null,
  }
}

export function newEnvFromRow(): EnvFromDraftRow {
  return {
    id: `new-env-from:${draftRowNonce()}`,
    source: 'configMapRef',
    name: '',
    prefix: '',
    optional: false,
  }
}

function envDraftRow(
  container: DeploymentEnvContainer,
  entry: DeploymentEnvContainer['env'][number],
  index: number,
): EnvDraftRow | null {
  if (isReadOnlyEnvSource(entry.source)) return null

  return {
    id: envRowId(container, index),
    name: entry.name,
    source: entry.source,
    value: entry.value ?? '',
    refName: entry.refName ?? '',
    key: entry.key ?? '',
    optional: entry.optional ?? false,
    apiVersion: entry.apiVersion ?? '',
    fieldPath: entry.fieldPath ?? '',
    containerName: entry.containerName ?? '',
    resource: entry.resource ?? '',
    divisor: entry.divisor ?? '',
  }
}

export function containerEnvDraft(container: DeploymentEnvContainer): ContainerEnvDraft {
  return {
    env: container.env.flatMap((entry, index) => {
      const row = envDraftRow(container, entry, index)

      return row ? [row] : []
    }),
    envFrom: container.envFrom.flatMap((entry, index) => {
      if (entry.source === 'unknown') return []

      return [
        {
          id: envFromRowId(container, index),
          source: entry.source,
          name: entry.name ?? '',
          prefix: entry.prefix ?? '',
          optional: entry.optional ?? false,
        },
      ]
    }),
  }
}

export function cleanOptional(value: boolean | null | undefined): boolean | null {
  return value == null ? null : value
}

export function cleanText(value: string | null | undefined): string | undefined {
  const normalized = (value ?? '').trim()

  return normalized || undefined
}

export function normalizedEnvDraft(draft: ContainerEnvDraft): DeploymentEnvUpdateInput {
  return {
    env: draft.env.map((row) => ({
      name: row.name.trim(),
      source: row.source,
      value: row.value ?? '',
      refName: cleanText(row.refName),
      key: cleanText(row.key),
      optional: cleanOptional(row.optional),
      apiVersion: cleanText(row.apiVersion),
      fieldPath: cleanText(row.fieldPath),
      containerName: cleanText(row.containerName),
      resource: cleanText(row.resource),
      divisor: cleanText(row.divisor),
    })),
    envFrom: draft.envFrom.map((row) => ({
      source: row.source,
      name: row.name.trim(),
      prefix: cleanText(row.prefix),
      optional: cleanOptional(row.optional),
    })),
  }
}

export function envDraftSignature(draft: ContainerEnvDraft) {
  return JSON.stringify(normalizedEnvDraft(draft))
}

export function resetEnvRowSource(
  row: EnvDraftRow,
  source: EditableDeploymentEnvSource,
): EnvDraftRow {
  return {
    id: row.id,
    name: row.name,
    source,
    value: source === 'value' ? (row.value ?? '') : '',
    refName: source === 'configMapKeyRef' || source === 'secretKeyRef' ? (row.refName ?? '') : '',
    key: source === 'configMapKeyRef' || source === 'secretKeyRef' ? (row.key ?? '') : '',
    optional:
      source === 'configMapKeyRef' || source === 'secretKeyRef' ? (row.optional ?? false) : null,
    apiVersion: source === 'fieldRef' ? (row.apiVersion ?? '') : '',
    fieldPath: source === 'fieldRef' ? (row.fieldPath ?? '') : '',
    containerName: source === 'resourceFieldRef' ? (row.containerName ?? '') : '',
    resource: source === 'resourceFieldRef' ? (row.resource ?? '') : '',
    divisor: source === 'resourceFieldRef' ? (row.divisor ?? '') : '',
  }
}
