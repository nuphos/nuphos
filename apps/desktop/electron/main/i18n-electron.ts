// The main process's language (i18n.ts) as the app wires it: saved under
// userData so the menu bar is right at launch, before any window reports in.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'

import { parseLocale, systemLocale, setMessages } from './i18n.ts'

import type { Messages } from './i18n.ts'
import type { Locale } from '../../src/i18n/languages.ts'

type Loader = () => Promise<{ default: Messages }>

// One chunk per language: only the one in use is read.
const loaders: Record<Exclude<Locale, 'en'>, Loader> = {
  'zh-TW': () => import('../../src/i18n/locales/zh-TW.json'),
  'zh-CN': () => import('../../src/i18n/locales/zh-CN.json'),
  ja: () => import('../../src/i18n/locales/ja.json'),
  ko: () => import('../../src/i18n/locales/ko.json'),
  th: () => import('../../src/i18n/locales/th.json'),
  id: () => import('../../src/i18n/locales/id.json'),
  es: () => import('../../src/i18n/locales/es.json'),
}

const localeFile = () => join(app.getPath('userData'), 'locale.json')

/** The language last asked for; the text switches once its file has loaded. */
let wanted: Locale = 'en'
const listeners = new Set<() => void>()

function savedLocale(): Locale {
  try {
    return parseLocale(
      (JSON.parse(readFileSync(localeFile(), 'utf8')) as { locale?: unknown }).locale,
    )
  } catch {
    return systemLocale(app.getPreferredSystemLanguages())
  }
}

/** Switches the text, then rebuilds whatever shows it (the menu bar). A locale
 *  file that fails to load leaves the text in English. */
async function load(locale: Locale): Promise<void> {
  if (locale === wanted) return
  wanted = locale
  let messages: Messages = {}

  try {
    if (locale !== 'en') messages = (await loaders[locale]()).default
  } catch (err) {
    console.warn('[i18n] could not load the menu language', locale, err)
  }
  // A newer choice arrived while this one loaded.
  if (wanted !== locale) return
  setMessages(messages)
  for (const listener of listeners) listener()
}

/** At launch: the language saved last time, else the system's. */
export function initMainLocale(): Promise<void> {
  return load(savedLocale())
}

/** A window reports the language it shows. */
export async function setMainLocale(value: unknown): Promise<void> {
  const next = parseLocale(value)

  if (next === wanted) return
  writeFileSync(localeFile(), JSON.stringify({ locale: next }))
  await load(next)
}

export function onMainLocaleChange(listener: () => void): void {
  listeners.add(listener)
}
