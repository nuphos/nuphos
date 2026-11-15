// Fills the missing translations of the mobile apps' strings from Desktop,
// wherever the English text is the same. Safe to run again.
//   node scripts/fill-mobile-locales.mjs ios
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const desktopLocales = new URL('../apps/desktop/src/i18n/locales/', import.meta.url)
const iosCatalog = new URL('../apps/ios/nuphos-ios/Localizable.xcstrings', import.meta.url)

/** Desktop locale code to the code iOS uses for the same language. */
const IOS_LANGUAGE = { 'zh-TW': 'zh-Hant', 'zh-CN': 'zh-Hans' }

// Any placeholder, so `{name} answered` and `%@ answered` compare equal.
export const SLOT = '\u0000'

// Desktop translations by English text: give the English with each
// placeholder as `SLOT`, and the platform's placeholders in English order.
export function desktopTranslator(messages) {
  const found = new Map()

  for (const [key, translation] of Object.entries(messages)) {
    const english = key.replace(/\|\w+$/, '')
    const names = [...english.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    const template = english.replaceAll(/\{\w+\}/g, SLOT)
    const known = found.get(template)

    // The same English translated two ways (the button "Open" and a pull
    // request's "Open") cannot be told apart from here, so neither is used.
    if (known && known.translation !== translation) known.ambiguous = true
    else if (!known) found.set(template, { names, translation })
  }

  return (template, placeholders) => {
    const match = found.get(template)

    if (!match || match.ambiguous || new Set(match.names).size !== placeholders.length) return
    let missing = false
    const out = match.translation.replaceAll(/\{(\w+)\}/g, (_, name) => {
      const index = match.names.indexOf(name)

      if (index === -1) missing = true

      return placeholders[index]
    })

    return missing ? undefined : out
  }
}

const IOS_FORMAT = /%(?:\d+\$)?(@|l{0,2}[du]|l?f)/g

/** Fills the missing translations of an iOS String Catalog in place. */
export function fillCatalog(catalog, translators) {
  let filled = 0

  for (const [key, entry] of Object.entries(catalog.strings)) {
    if (!key || entry.shouldTranslate === false) continue
    const english = entry.localizations?.en?.stringUnit?.value ?? key
    const types = [...english.matchAll(IOS_FORMAT)].map((m) => m[1])

    // `%%` and formats this does not know are left for a person.
    if (english.replaceAll(IOS_FORMAT, '').includes('%')) continue
    const template = english.replaceAll(IOS_FORMAT, SLOT)
    // A lone placeholder stays as written; several are numbered so a
    // translation can reorder them.
    const placeholders = types.map((type, i) =>
      types.length === 1 ? `%${type}` : `%${i + 1}$${type}`,
    )

    for (const [language, translate] of Object.entries(translators)) {
      if (entry.localizations?.[language]) continue
      const value = translate(template, placeholders)

      // A string with arguments goes through a formatter, where a literal
      // percent sign in the translation would need escaping: left for a person.
      if (value === undefined || (types.length > 0 && value.split('%').length - 1 !== types.length))
        continue
      entry.localizations = sorted({
        ...entry.localizations,
        [language]: { stringUnit: { state: 'translated', value } },
      })
      filled++
    }
  }

  return filled
}

const sorted = (object) =>
  Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : 1)))

/** JSON the way Xcode writes a String Catalog, so a run leaves no other diff. */
export function catalogJSON(value, indent = '') {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  const inner = `${indent}  `
  const isArray = Array.isArray(value)
  const items = isArray
    ? value.map((item) => inner + catalogJSON(item, inner))
    : Object.entries(value).map(
        ([k, v]) => `${inner}${JSON.stringify(k)} : ${catalogJSON(v, inner)}`,
      )
  const [open, close] = isArray ? '[]' : '{}'

  return `${open}\n${items.join(',\n')}\n${indent}${close}`
}

function desktopTranslators(languageOf) {
  const translators = {}

  for (const name of readdirSync(desktopLocales)) {
    const locale = name.replace(/\.json$/, '')
    const messages = JSON.parse(readFileSync(new URL(name, desktopLocales), 'utf8'))

    translators[languageOf(locale)] = desktopTranslator(messages)
  }

  return translators
}

const TARGETS = {
  ios() {
    const catalog = JSON.parse(readFileSync(iosCatalog, 'utf8'))
    const filled = fillCatalog(
      catalog,
      desktopTranslators((locale) => IOS_LANGUAGE[locale] ?? locale),
    )

    writeFileSync(iosCatalog, catalogJSON(catalog))

    return filled
  },
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = TARGETS[process.argv[2]]

  if (!target) {
    console.error(`usage: node scripts/fill-mobile-locales.mjs <${Object.keys(TARGETS).join('|')}>`)
    process.exit(2)
  }
  console.log(`Filled ${target()} translations from Desktop.`)
}
