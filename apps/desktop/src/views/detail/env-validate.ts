import { cleanText } from './env-model'

import type { ContainerEnvDraft } from './env-model'

export function validateEnvName(name: string): string | null {
  if (!name) return 'Environment variable names cannot be empty.'
  if (!/^[\x20-\x7E]+$/.test(name) || name.includes('=')) {
    return `"${name}" must use printable ASCII characters except "=".`
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
    if (reserved.has(name)) return `"${name}" is already defined by a read-only reference.`
    if (names.has(name)) return `"${name}" is duplicated.`
    names.add(name)
    if (
      (row.source === 'configMapKeyRef' || row.source === 'secretKeyRef') &&
      !cleanText(row.refName)
    ) {
      return `"${name}" needs a ${row.source === 'secretKeyRef' ? 'Secret' : 'ConfigMap'} name.`
    }
    if (
      (row.source === 'configMapKeyRef' || row.source === 'secretKeyRef') &&
      !cleanText(row.key)
    ) {
      return `"${name}" needs a key.`
    }
    if (row.source === 'fieldRef' && !cleanText(row.fieldPath)) {
      return `"${name}" needs a field path.`
    }
    if (row.source === 'resourceFieldRef' && !cleanText(row.resource)) {
      return `"${name}" needs a resource.`
    }
  }
  for (const row of draft.envFrom) {
    const sourceLabel = row.source === 'secretRef' ? 'Secret' : 'ConfigMap'

    if (!row.name.trim()) return `${sourceLabel} envFrom name cannot be empty.`
    const prefix = row.prefix?.trim()

    if (prefix && !/^[A-Za-z_]\w*$/.test(prefix)) {
      return `"${prefix}" is not a valid envFrom prefix.`
    }
  }

  return null
}
