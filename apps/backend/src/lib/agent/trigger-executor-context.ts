export function resolveMessageTemplate(template: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return template

  return template.replace(/\{\{(?=([^}]+))\1\}\}/g, (match, path: string) => {
    const keys = path.trim().split('.')
    let value: unknown = payload

    for (const key of keys) {
      if (value == null || typeof value !== 'object') return match
      value = (value as Record<string, unknown>)[key]
    }
    if (value == null) return match
    if (typeof value === 'object') return JSON.stringify(value)
    if (typeof value === 'string') return value
    if (typeof value === 'symbol' || typeof value === 'function') return value.toString()
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value)
    }

    return match
  })
}

/** The provider's own words for the alert state, passed through unclassified. */
export function readReportedStatus(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const root = payload as Record<string, unknown>
  const nested = [root.incident, root.data, (root.data as Record<string, unknown>)?.attributes]

  for (const source of [root, ...nested]) {
    if (!source || typeof source !== 'object') continue
    for (const field of ['status', 'state', 'severity', 'alertState']) {
      const value = (source as Record<string, unknown>)[field]

      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }

  return undefined
}
