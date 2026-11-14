import { readLocalStorage, writeLocalStorage } from '../app/localStorage.ts'

import es from './locales/es.json' with { type: 'json' }
import id from './locales/id.json' with { type: 'json' }
import ja from './locales/ja.json' with { type: 'json' }
import ko from './locales/ko.json' with { type: 'json' }
import th from './locales/th.json' with { type: 'json' }
import zhCN from './locales/zh-CN.json' with { type: 'json' }
import zhTW from './locales/zh-TW.json' with { type: 'json' }
import { englishText, fillText, LOCALES, matchLocale } from './languages.ts'

import type { Locale } from './languages.ts'

/**
 * UI text is written in English and the English string is the key. A locale
 * maps it to a translation; anything missing falls back to the English text,
 * so untranslated screens still work.
 */
export type Messages = Record<string, string>

export { LOCALES, matchLocale } from './languages.ts'
export type { Locale } from './languages.ts'

export const MESSAGES: Record<Exclude<Locale, 'en'>, Messages> = {
  'zh-TW': zhTW,
  'zh-CN': zhCN,
  ja,
  ko,
  th,
  id,
  es,
}

const KEY = 'nuphos.locale'

function detectLocale(): Locale {
  const saved = readLocalStorage(KEY)

  if (saved && LOCALES.some((l) => l.code === saved)) return saved as Locale
  // Node also defines navigator; keep tests deterministic in English.
  const preferred = typeof window === 'undefined' ? [] : navigator.languages

  for (const tag of preferred) {
    const match = matchLocale(tag)

    if (match) return match
  }

  return 'en'
}

export const locale: Locale = detectLocale()

if (typeof document !== 'undefined') document.documentElement.lang = locale

// Shown text back to the English an English user would see, so error reports
// match across locales.
const sources = new Map<string, string>()

export function sourceText(shown: string): string {
  return sources.get(shown) ?? shown
}

/**
 * Translates English UI text; `{name}` placeholders are filled from `vars`. A
 * `|context` suffix tells apart the same English word used two ways (the
 * button "Open" vs. a pull request's "Open|state") and is never shown.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const english = englishText(text)
  const fill = (s: string, map?: (v: string) => string) => fillText(s, vars, map)

  if (locale === 'en') return fill(english)
  const out = fill(MESSAGES[locale][text] ?? english)

  // A Map keeps insertion order, so the first key is the oldest.
  if (sources.size >= 5000) sources.delete(sources.keys().next().value!)
  // A value that is itself translated text goes back to English too.
  sources.set(out, fill(english, sourceText))

  return out
}

/** Text is read once at startup, so switching reloads every open window. */
export function setLocale(next: Locale) {
  writeLocalStorage(KEY, next)
  window.location.reload()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) window.location.reload()
  })
}
