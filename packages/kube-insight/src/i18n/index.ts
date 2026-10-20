import { en } from './en.ts'
import { LOCALES } from './types.ts'

import type { Catalog, Locale, Template } from './types.ts'
import type { Message } from '../message.ts'

export const CATALOGS: Record<Locale, Catalog> = { en }

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole)
}

/**
 * The sentence for `key` in `locale`, falling back to English, then to the key
 * itself so a missing translation is visible rather than blank.
 */
export function translate(
  locale: Locale,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const values: Record<string, string> = {}

  for (const [name, value] of Object.entries(params)) values[name] = String(value)
  const template = CATALOGS[locale][key] ?? CATALOGS.en[key]

  if (template == null) return key

  return typeof template === 'function' ? template(values) : fill(template, values)
}

export function renderMessage(locale: Locale, msg: Message): string {
  return translate(locale, msg.key, msg.params)
}

export { LOCALES }
export type { Catalog, Locale, Template }
