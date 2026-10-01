import { BSON } from 'mongodb'

const MAX_VIEW_PIPELINE_STAGES = 50

const SENSITIVE_METADATA_FIELD =
  /(?:passw|secret|token|credential|private.?key|api.?key|email|phone|mobile|address|ssn|id.?card|credit.?card)/i
const SAFE_VIEW_STRING_KEYS = new Set([
  'from',
  'localField',
  'foreignField',
  'as',
  'path',
  'viewOn',
])
const SAFE_VIEW_NUMBER_STAGES = new Set(['$limit', '$skip', '$sample'])
const SAFE_VIEW_STRING_STAGES = new Set(['$count', '$unset'])

export function metadataByteSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(BSON.EJSON.serialize(value)))
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function fitMetadataItems<T>(
  items: T[],
  maxBytes: number,
  envelope: (selected: T[]) => unknown,
): { items: T[]; truncated: boolean } {
  const selected: T[] = []

  for (const item of items) {
    const candidate = [...selected, item]

    if (metadataByteSize(envelope(candidate)) > maxBytes) break
    selected.push(item)
  }

  return { items: selected, truncated: selected.length < items.length }
}

function redactSensitiveMetadata(
  value: unknown,
  key = '',
  depth = 0,
): { value: unknown; truncated: boolean } {
  if (SENSITIVE_METADATA_FIELD.test(key)) return { value: '[REDACTED]', truncated: false }
  if (depth >= 10) return { value: '[TRUNCATED]', truncated: true }
  if (Array.isArray(value)) {
    const selected = value.slice(0, 100)
    let truncated = selected.length < value.length
    const output = selected.map((item) => {
      const nested = redactSensitiveMetadata(item, '', depth + 1)

      truncated ||= nested.truncated

      return nested.value
    })

    return { value: output, truncated }
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const selected = entries.slice(0, 200)
    let truncated = selected.length < entries.length
    const output: Record<string, unknown> = {}

    for (const [nestedKey, nestedValue] of selected) {
      const nested = redactSensitiveMetadata(nestedValue, nestedKey, depth + 1)

      output[nestedKey] = nested.value
      truncated ||= nested.truncated
    }

    return { value: output, truncated }
  }
  if (typeof value === 'string' && value.length > 2_048) {
    return { value: `${value.slice(0, 2_048)}…`, truncated: true }
  }

  return { value, truncated: false }
}

export function boundedMetadataRecord(
  value: unknown,
  maxBytes: number,
): { value: Record<string, unknown>; truncated: boolean } {
  const serialized = jsonRecord(value)
  const redacted = redactSensitiveMetadata(serialized)
  const record = redacted.value as Record<string, unknown>

  if (metadataByteSize(record) <= maxBytes) return { value: record, truncated: redacted.truncated }

  return {
    value: { $nuphosMetadata: 'Metadata exceeded the safe response limit.' },
    truncated: true,
  }
}

function sanitizeViewNode(
  value: unknown,
  key: string,
  stage: string,
  state: { truncated: boolean },
  depth = 0,
): unknown {
  if (SENSITIVE_METADATA_FIELD.test(key)) return '[REDACTED]'
  if (depth >= 10) {
    state.truncated = true

    return '[TRUNCATED]'
  }
  if (Array.isArray(value)) {
    if (value.length > 100) state.truncated = true

    return value.slice(0, 100).map((item) => sanitizeViewNode(item, '', stage, state, depth + 1))
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>)

    if (entries.length > 200) state.truncated = true
    for (const [nestedKey, nestedValue] of entries.slice(0, 200)) {
      output[nestedKey] = sanitizeViewNode(nestedValue, nestedKey, stage, state, depth + 1)
    }

    return output
  }
  if (typeof value === 'string') {
    if (
      value.startsWith('$') ||
      SAFE_VIEW_STRING_KEYS.has(key) ||
      SAFE_VIEW_STRING_STAGES.has(stage)
    ) {
      return value.length > 512 ? `${value.slice(0, 512)}…` : value
    }

    return '[string]'
  }
  if (typeof value === 'number') {
    if (SAFE_VIEW_NUMBER_STAGES.has(stage) || (stage === '$project' && [-1, 0, 1].includes(value)))
      return value

    return '[number]'
  }
  if (typeof value === 'boolean') return stage === '$project' ? value : '[boolean]'
  if (value === null) return null

  return `[${typeof value}]`
}

export function sanitizeMongoViewPipeline(value: unknown): {
  pipeline: Record<string, unknown>[]
  truncated: boolean
} {
  if (!Array.isArray(value)) return { pipeline: [], truncated: false }
  const state = { truncated: value.length > MAX_VIEW_PIPELINE_STAGES }
  const pipeline = value.slice(0, MAX_VIEW_PIPELINE_STAGES).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      state.truncated = true

      return []
    }
    const stageDocument = item as Record<string, unknown>
    const stage = Object.keys(stageDocument)[0] ?? ''

    return [sanitizeViewNode(stageDocument, '', stage, state) as Record<string, unknown>]
  })

  return { pipeline, truncated: state.truncated }
}

export function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}

  return BSON.EJSON.serialize(value) as Record<string, unknown>
}
