// Text the main process shows itself, the menu bar and notifications, in the
// language picked in the app. The windows report that language; the strings
// come from the same locale files, so i18n.test.ts checks them too.
//
// Runtime imports stay free of Electron so this loads under plain `node --test`.

import { englishText, fillText, LOCALES, matchLocale } from '../../src/i18n/languages.ts'

import type { Locale } from '../../src/i18n/languages.ts'

export type Messages = Record<string, string>

let messages: Messages = {}

export function setMessages(next: Messages): void {
  messages = next
}

/** Same as the windows' t(): English is the key, missing text stays English. */
export function t(text: string, vars?: Record<string, string | number>): string {
  return fillText(messages[text] ?? englishText(text), vars)
}

export function parseLocale(value: unknown): Locale {
  const match = LOCALES.find((l) => l.code === value)

  if (!match) throw new Error(`Invalid locale: ${String(value)}`)

  return match.code
}

/** The language a window would pick before any choice is saved: the system's. */
export function systemLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const match = matchLocale(tag)

    if (match) return match
  }

  return 'en'
}
