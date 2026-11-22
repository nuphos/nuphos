import { AppError } from '@/lib/errors'

import type { TriggerType } from './trigger-db'

/** A webhook fires only when every rule holds. Strings only, exact match, no expressions. */
export type PayloadFilter = { path: string; in?: string[]; notIn?: string[] }

const PATH = /^[\w-]{1,64}(\.[\w-]{1,64}){0,7}$/
const MAX_RULES = 10
const MAX_VALUES = 50

const invalid = (message: string) => new AppError(400, 'invalid_payload_filters', message)
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length <= MAX_VALUES &&
  v.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 200)

/** Returns the rules as stored, or throws a 400 for anything that is not a plain allow/deny list. */
export function parsePayloadFilters(triggerType: TriggerType, value: unknown): PayloadFilter[] {
  if (triggerType !== 'webhook') throw invalid('payloadFilters is only valid for webhook triggers')
  if (!Array.isArray(value) || value.length > MAX_RULES) {
    throw invalid(`payloadFilters must be a list of at most ${String(MAX_RULES)} rules`)
  }

  return value.map((raw: unknown) => {
    const rule = (raw ?? {}) as Record<string, unknown>
    const extra = Object.keys(rule).filter((k) => !['path', 'in', 'notIn'].includes(k))

    if (typeof rule.path !== 'string' || !PATH.test(rule.path) || extra.length > 0) {
      throw invalid('Each rule needs a dot path and only `in` and `notIn`')
    }
    if (rule.in === undefined && rule.notIn === undefined) {
      throw invalid(`Rule "${rule.path}" needs \`in\` or \`notIn\``)
    }
    for (const key of ['in', 'notIn'] as const) {
      if (rule[key] !== undefined && !strings(rule[key])) {
        throw invalid(`\`${key}\` must be a list of 1 to ${String(MAX_VALUES)} non-empty strings`)
      }
    }

    return {
      path: rule.path,
      ...(rule.in ? { in: rule.in as string[] } : {}),
      ...(rule.notIn ? { notIn: rule.notIn as string[] } : {}),
    }
  })
}

const valueAt = (payload: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (at, key) =>
        typeof at === 'object' && at !== null && Object.hasOwn(at, key)
          ? (at as Record<string, unknown>)[key]
          : undefined,
      payload,
    )

/** A missing or non-string value never matches `in` and always passes `notIn`. */
export function matchesPayloadFilters(payload: unknown, filters: PayloadFilter[] = []): boolean {
  return filters.every((rule) => {
    const found = valueAt(payload, rule.path)
    const text = typeof found === 'string' ? found : undefined

    return (
      (!rule.in || (text !== undefined && rule.in.includes(text))) &&
      (!rule.notIn || text === undefined || !rule.notIn.includes(text))
    )
  })
}
