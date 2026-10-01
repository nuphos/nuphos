import { AppError } from '@/lib/errors'

import { filterId } from './normalize'

import type { RawDashboardFilter } from './types'

function safeFilterValue(value: string): string {
  const trimmed = value.trim()

  if (!trimmed || trimmed === '*' || trimmed === 'All') return ''
  // Dashboard controls are label values, not query fragments. Keep the free-
  // text fallback useful while preventing a value from becoming filter syntax
  // when a provider dashboard uses an unquoted template placeholder.
  if (!/^[\p{L}\p{N}_./:@+ -]{1,256}$/u.test(trimmed)) {
    throw new AppError(
      400,
      'invalid_dashboard_filter_value',
      'Dashboard filter values may not contain query syntax',
    )
  }

  return trimmed
}

function quoteFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function filterField(filter: RawDashboardFilter): string | null {
  const key = filter.labelKey?.trim()

  if (!key) return null
  if (key.includes('.')) return key
  switch (filter.filterType) {
    case 'RESOURCE_LABEL':
      return `resource.labels.${key}`
    case 'METRIC_LABEL':
      return `metric.labels.${key}`
    case 'USER_METADATA_LABEL':
      return `metadata.user_labels.${key}`
    case 'SYSTEM_METADATA_LABEL':
      return `metadata.system_labels.${key}`
    case 'GROUP':
      return 'group.id'
    case undefined:
    default:
      return null
  }
}

export function applyDashboardFilterSelections(
  baseFilter: string,
  definitions: RawDashboardFilter[],
  selections: Record<string, string>,
): string {
  let result = baseFilter

  for (const [index, definition] of definitions.entries()) {
    const id = filterId(definition, index)
    const selectedRaw =
      selections[id] ?? definition.stringValue ?? definition.stringArrayValue?.values?.[0] ?? ''
    const selected = safeFilterValue(selectedRaw)

    const staticOptions = definition.stringArray?.values ?? []

    if (selected && staticOptions.length > 0 && !staticOptions.includes(selected)) {
      throw new AppError(
        400,
        'invalid_dashboard_filter_value',
        `Value is not valid for dashboard filter ${id}`,
      )
    }

    const variable = definition.templateVariable?.trim()

    if (variable) {
      const field = filterField(definition)
      const labelBased = definition.filterType !== 'VALUE_ONLY' && field !== null

      result = result.replace(
        /\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_.-]*)|\{\{\s*([^{}\s]+)\s*\}\}/g,
        (
          match,
          braced: string | undefined,
          bare: string | undefined,
          handlebars: string | undefined,
          offset: number,
          source: string,
        ) => {
          const referenced = braced ?? bare ?? handlebars ?? ''
          const valueOnly = referenced.endsWith('.value')
          const referencedVariable = valueOnly ? referenced.slice(0, -'.value'.length) : referenced

          if (referencedVariable !== variable) return match

          if (labelBased) {
            if (valueOnly) {
              throw new AppError(
                422,
                'gcp_dashboard_query_unsupported',
                `Cloud Monitoring filter queries do not support value-only dereferencing for label variable ${variable}`,
              )
            }

            return selected ? `${field} = "${quoteFilterValue(selected)}"` : ''
          }

          const value = quoteFilterValue(selected || '.*')
          const alreadyQuoted = source[offset - 1] === '"' && source[offset + match.length] === '"'

          return alreadyQuoted ? value : `"${value}"`
        },
      )
      continue
    }

    if (!selected) continue
    const field = filterField(definition)

    if (field) {
      result = `(${result}) AND ${field} = "${quoteFilterValue(selected)}"`
    }
  }

  return result
}
