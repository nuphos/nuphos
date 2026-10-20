/** A sentence template: `{name}` placeholders, or a function for conditional wording. */
export type Template = string | ((params: Record<string, string>) => string)

export type Catalog = Record<string, Template>

/** Desktop ships in English only; add a catalog here when the app gains a language. */
export const LOCALES = ['en'] as const

export type Locale = (typeof LOCALES)[number]
