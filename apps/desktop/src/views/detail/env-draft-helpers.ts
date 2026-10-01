import {
  containerEnvDraft,
  deploymentEnvContainerKey,
  envDraftSignature,
  isReadOnlyEnvSource,
} from './env-model'

import type { ContainerEnvDraft, EnvFromTableRow, EnvTableRow } from './env-model'
import type { DeploymentEnvContainer } from '../../types'

export function draftsForContainers(
  containers: DeploymentEnvContainer[],
): Record<string, ContainerEnvDraft> {
  const nextDrafts: Record<string, ContainerEnvDraft> = {}

  for (const container of containers) {
    nextDrafts[deploymentEnvContainerKey(container)] = containerEnvDraft(container)
  }

  return nextDrafts
}

// A reload keeps the other containers' in-progress edits; only the freshly
// saved (preferred) container — and containers without a draft — take the
// server's state.
export function mergeReloadedDrafts(
  current: Record<string, ContainerEnvDraft>,
  containers: DeploymentEnvContainer[],
  nextDrafts: Record<string, ContainerEnvDraft>,
  preferredKey?: string | null,
): Record<string, ContainerEnvDraft> {
  if (!preferredKey) return nextDrafts
  const mergedDrafts: Record<string, ContainerEnvDraft> = {}

  for (const container of containers) {
    const key = deploymentEnvContainerKey(container)

    mergedDrafts[key] = key === preferredKey || !current[key] ? nextDrafts[key] : current[key]
  }

  return mergedDrafts
}

export function pickSelectedKey(
  current: string | null,
  keys: string[],
  preferredKey?: string | null,
): string | null {
  if (preferredKey && keys.includes(preferredKey)) return preferredKey
  if (current && keys.includes(current)) return current

  return keys[0] ?? null
}

export function computeDirtyKeys(
  containers: DeploymentEnvContainer[] | null,
  drafts: Record<string, ContainerEnvDraft>,
): Set<string> {
  const nextDirtyKeys = new Set<string>()

  for (const container of containers ?? []) {
    const key = deploymentEnvContainerKey(container)
    const original = containerEnvDraft(container)
    const draft = drafts[key] ?? original

    if (envDraftSignature(draft) !== envDraftSignature(original)) {
      nextDirtyKeys.add(key)
    }
  }

  return nextDirtyKeys
}

export function unknownEnvEntriesFor(selectedContainer: DeploymentEnvContainer | null) {
  return selectedContainer?.env.filter((entry) => isReadOnlyEnvSource(entry.source)) ?? []
}

export function unknownEnvFromEntriesFor(selectedContainer: DeploymentEnvContainer | null) {
  return selectedContainer?.envFrom.filter((entry) => entry.source === 'unknown') ?? []
}

export function buildEnvTableRows(
  selectedDraft: ContainerEnvDraft,
  unknownEnvEntries: DeploymentEnvContainer['env'],
): EnvTableRow[] {
  return [
    ...selectedDraft.env.map((row): EnvTableRow => ({ kind: 'editable', row })),
    ...unknownEnvEntries.map((entry, index): EnvTableRow => ({
      kind: 'unknown',
      entry,
      id: `unknown-env:${String(index)}:${entry.name}`,
    })),
  ]
}

export function buildEnvFromTableRows(
  selectedDraft: ContainerEnvDraft,
  unknownEnvFromEntries: DeploymentEnvContainer['envFrom'],
): EnvFromTableRow[] {
  return [
    ...selectedDraft.envFrom.map((row): EnvFromTableRow => ({ kind: 'editable', row })),
    ...unknownEnvFromEntries.map((entry, index): EnvFromTableRow => ({
      kind: 'unknown',
      entry,
      id: `unknown-env-from:${String(index)}:${entry.source}:${entry.name ?? ''}`,
    })),
  ]
}

export function unsavedStatusText(changed: boolean, dirtyCount: number): string | null {
  const otherDirtyCount = changed ? dirtyCount - 1 : dirtyCount

  return changed
    ? otherDirtyCount > 0
      ? `Unsaved changes (+${String(otherDirtyCount)})`
      : 'Unsaved changes'
    : dirtyCount > 0
      ? `${String(dirtyCount)} unsaved elsewhere`
      : null
}
