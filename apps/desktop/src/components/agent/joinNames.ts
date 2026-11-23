import { t } from '../../i18n'

/** "Ann", "Ann and Bo", "Ann, Bo, and 2 others". */
export function joinNames(names: string[]) {
  if (names.length === 2) return t('{a} and {b}', { a: names[0], b: names[1] })
  if (names.length < 2) return names.join('')
  const others = names.length - 2

  return others === 1
    ? t('{a}, {b}, and 1 other', { a: names[0], b: names[1] })
    : t('{a}, {b}, and {n} others', { a: names[0], b: names[1], n: String(others) })
}
