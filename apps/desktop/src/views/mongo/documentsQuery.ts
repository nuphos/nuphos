import { t } from '../../i18n/index.ts'

import type { MongoReadQueryInput } from '../../types'

export type QueryOperation = MongoReadQueryInput['operation']

export const OPERATIONS: { value: QueryOperation; label: string; description: string }[] = [
  { value: 'find', label: t('Find'), description: t('Filter and inspect documents') },
  { value: 'aggregate', label: t('Aggregations'), description: t('Run a read-only pipeline') },
  { value: 'count', label: t('Count|operation'), description: t('Count matching documents') },
  { value: 'explain', label: t('Explain'), description: t('Inspect query execution stats') },
]

export const EMPTY_PIPELINE = '[\n  { "$match": {} }\n]'

export function parseObjectEditor(label: string, source: string): Record<string, unknown> {
  const trimmed = source.trim()

  if (!trimmed) return {}
  const value = JSON.parse(trimmed) as unknown

  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(t('{label} must be a JSON object.', { label }))

  return value as Record<string, unknown>
}

export function parseArrayEditor(label: string, source: string): Record<string, unknown>[] {
  const trimmed = source.trim()

  if (!trimmed) return []
  const value = JSON.parse(trimmed) as unknown

  if (
    !Array.isArray(value) ||
    value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))
  ) {
    throw new Error(t('{label} must be a JSON array of stage objects.', { label }))
  }

  return value as Record<string, unknown>[]
}

export function parseSort(source: string): Record<string, 1 | -1> {
  const value = parseObjectEditor(t('Sort'), source)

  for (const [key, direction] of Object.entries(value)) {
    if (direction !== 1 && direction !== -1)
      throw new Error(t('Sort direction for “{field}” must be 1 or -1.', { field: key }))
  }

  return value as Record<string, 1 | -1>
}

export function prettyJson(value: unknown, fallback: string): string {
  return JSON.stringify(value ?? JSON.parse(fallback), null, 2)
}

export function displayValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return JSON.stringify(value)
}

export function csvCell(value: unknown): string {
  const text = displayValue(value)
  const safe = /^[=+@-]/.test(text) ? `'${text}` : text

  return `"${safe.replaceAll('"', '""')}"`
}

export function operationAction(operation: QueryOperation): string {
  if (operation === 'aggregate') return t('Run pipeline')
  if (operation === 'count') return t('Count|operation')
  if (operation === 'explain') return t('Explain')

  return t('Find')
}
