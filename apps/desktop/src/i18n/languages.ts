// The supported languages, kept apart from the translations so the main process
// can read them without loading every locale file.

export const LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'th', name: 'ไทย' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'es', name: 'Español' },
] as const

export type Locale = (typeof LOCALES)[number]['code']

/** Maps a BCP 47 tag (e.g. from navigator.languages) to a supported locale. */
export function matchLocale(tag: string): Locale | undefined {
  const lower = tag.toLowerCase()

  if (lower.startsWith('zh')) {
    return /-(tw|hk|mo|hant)\b/.test(lower) ? 'zh-TW' : 'zh-CN'
  }

  return LOCALES.find((l) => l.code === lower.split('-')[0])?.code
}

/** The English text of a key: a `|context` suffix only tells keys apart. */
export const englishText = (text: string) => text.replace(/\|\w+$/, '')

/** Fills `{name}` placeholders from `vars`, each value passed through `map`. */
export function fillText(
  text: string,
  vars?: Record<string, string | number>,
  map = (value: string) => value,
): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => map(String(vars[k] ?? m))) : text
}
