import type { Column } from './support.ts'

/**
 * One visual contract for every value that navigates from a table cell.
 * Descendants are forced to inherit because many identifier renderers contain
 * nested text-main/text-secondary spans that would otherwise hide the link.
 */
export const TABLE_CELL_ACTION_CLASS =
  'inline-block max-w-full cursor-pointer overflow-hidden text-ellipsis align-middle text-left text-zViolet-accent hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zViolet-accent/70 [&_*]:!text-inherit'

const PRIMARY_IDENTIFIER_KEYS = [
  'name',
  'title',
  'label',
  'text',
  'repository',
  'project',
  'service',
  'subject',
  'email',
  'key',
  'path',
  'url',
] as const

function keyWords(key: string): string[] {
  return key
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split('_')
}

export function primaryActionColumnKey<T>(columns: Column<T>[]): string | null {
  const explicit = columns.find((column) => column.primaryAction)

  if (explicit) return explicit.key
  const visible = columns.filter((column) => column.header !== '')

  for (const identifier of PRIMARY_IDENTIFIER_KEYS) {
    const conventional = visible.find((column) => keyWords(column.key).includes(identifier))

    if (conventional) return conventional.key
  }
  const machineIdentifier = visible.find((column) => {
    const words = keyWords(column.key)

    return words.includes('number') || words.includes('id')
  })

  if (machineIdentifier) return machineIdentifier.key

  return visible.length > 0 ? visible[0].key : null
}
