import { readLocalStorage, writeLocalStorage } from '../app/localStorage.ts'

import es from './locales/es.json' with { type: 'json' }
import id from './locales/id.json' with { type: 'json' }
import ja from './locales/ja.json' with { type: 'json' }
import ko from './locales/ko.json' with { type: 'json' }
import th from './locales/th.json' with { type: 'json' }
import zhCN from './locales/zh-CN.json' with { type: 'json' }
import zhTW from './locales/zh-TW.json' with { type: 'json' }

/**
 * UI text is written in English and the English string is the key. A locale
 * maps it to a translation; anything missing falls back to the English text,
 * so untranslated screens still work.
 */
export type Messages = Record<string, string>

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

/** Maps a BCP 47 tag (e.g. from navigator.languages) to a supported locale. */
export function matchLocale(tag: string): Locale | undefined {
  const lower = tag.toLowerCase()

  if (lower.startsWith('zh')) {
    return /-(tw|hk|mo|hant)\b/.test(lower) ? 'zh-TW' : 'zh-CN'
  }

  return LOCALES.find((l) => l.code === lower.split('-')[0])?.code
}

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

// Shown text back to its English key, so error reports group the same way in
// every locale.
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
  const translated =
    (locale === 'en' ? undefined : MESSAGES[locale][text]) ?? text.replace(/\|\w+$/, '')
  const out = vars
    ? translated.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m))
    : translated

  if (locale !== 'en') {
    if (sources.size > 5000) sources.clear()
    sources.set(out, text.replace(/\|\w+$/, ''))
  }

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
