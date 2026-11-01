import { t } from '../../i18n/index.ts'

import { cleanText } from './env-model'

import type { ContainerEnvDraft } from './env-model'

export function validateEnvName(name: string): string | null {
  if (!name) return t('Environment variable names cannot be empty.')
  if (!/^[\x20-\x7E]+$/.test(name) || name.includes('=')) {
    return t('"{name}" must use printable ASCII characters except "=".', { name })
  }

  return null
}

export function validateEnvDraft(
  draft: ContainerEnvDraft,
  reservedNames: Iterable<string> = [],
): string | null {
  const names = new Set<string>()
  const reserved = new Set(Array.from(reservedNames, (name) => name.trim()).filter(Boolean))

  for (const row of draft.env) {
    const name = row.name.trim()
    const nameError = validateEnvName(name)

    if (nameError) return nameError
    if (reserved.has(name))
      return t('"{name}" is already defined by a read-only reference.', { name })
    if (names.has(name)) return t('"{name}" is duplicated.', { name })
    names.add(name)
    if (
      (row.source === 'configMapKeyRef' || row.source === 'secretKeyRef') &&
      !cleanText(row.refName)
    ) {
      return row.source === 'secretKeyRef'
        ? t('"{name}" needs a Secret name.', { name })
        : t('"{name}" needs a ConfigMap name.', { name })
    }
    if (
      (row.source === 'configMapKeyRef' || row.source === 'secretKeyRef') &&
      !cleanText(row.key)
    ) {
      return t('"{name}" needs a key.', { name })
    }
    if (row.source === 'fieldRef' && !cleanText(row.fieldPath)) {
      return t('"{name}" needs a field path.', { name })
    }
    if (row.source === 'resourceFieldRef' && !cleanText(row.resource)) {
      return t('"{name}" needs a resource.', { name })
    }
  }
  for (const row of draft.envFrom) {
    const sourceLabel = row.source === 'secretRef' ? 'Secret' : 'ConfigMap'

    if (!row.name.trim()) return t('{kind} envFrom name cannot be empty.', { kind: sourceLabel })
    const prefix = row.prefix?.trim()

    if (prefix && !/^[A-Za-z_]\w*$/.test(prefix)) {
      return t('"{prefix}" is not a valid envFrom prefix.', { prefix })
    }
  }

  return null
}
