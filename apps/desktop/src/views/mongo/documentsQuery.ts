import type { MongoReadQueryInput } from '../../types'

export type QueryOperation = MongoReadQueryInput['operation']

export const OPERATIONS: { value: QueryOperation; label: string; description: string }[] = [
  { value: 'find', label: 'Find', description: 'Filter and inspect documents' },
  { value: 'aggregate', label: 'Aggregations', description: 'Run a read-only pipeline' },
  { value: 'count', label: 'Count', description: 'Count matching documents' },
  { value: 'explain', label: 'Explain', description: 'Inspect query execution stats' },
]

export const EMPTY_PIPELINE = '[\n  { "$match": {} }\n]'

export function parseObjectEditor(label: string, source: string): Record<string, unknown> {
  const trimmed = source.trim()

  if (!trimmed) return {}
  const value = JSON.parse(trimmed) as unknown

  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be a JSON object.`)

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
    throw new Error(`${label} must be a JSON array of stage objects.`)
  }

  return value as Record<string, unknown>[]
}

export function parseSort(source: string): Record<string, 1 | -1> {
  const value = parseObjectEditor('Sort', source)

  for (const [key, direction] of Object.entries(value)) {
    if (direction !== 1 && direction !== -1)
      throw new Error(`Sort direction for “${key}” must be 1 or -1.`)
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
  if (operation === 'aggregate') return 'Run pipeline'
  if (operation === 'count') return 'Count'
  if (operation === 'explain') return 'Explain'

  return 'Find'
}
