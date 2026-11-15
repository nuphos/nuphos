import assert from 'node:assert/strict'
import test from 'node:test'

import { catalogJSON, desktopTranslator, fillCatalog } from './fill-mobile-locales.mjs'

const ja = desktopTranslator({
  'New task': '新しいタスク',
  Open: '開く',
  'Open|state': 'オープン',
  'Asked {asked} · Answered {answered}': '{answered}に回答 · {asked}に質問',
  '{n}% left': '残り {n}%',
})
const fill = (strings) => {
  const catalog = { sourceLanguage: 'en', strings }

  fillCatalog(catalog, { ja })

  return Object.fromEntries(
    Object.entries(catalog.strings).map(([key, entry]) => [
      key,
      entry.localizations?.ja?.stringUnit.value,
    ]),
  )
}

test('a string takes the Desktop translation of the same English text', () => {
  assert.deepEqual(fill({ 'New task': {}, 'Only on the phone': {} }), {
    'New task': '新しいタスク',
    'Only on the phone': undefined,
  })
})

test('placeholders follow the order the translation needs', () => {
  assert.deepEqual(fill({ 'Asked %@ · Answered %@': {} }), {
    'Asked %@ · Answered %@': '%2$@に回答 · %1$@に質問',
  })
})

test('a translation written by hand is kept', () => {
  const byHand = { ja: { stringUnit: { state: 'translated', value: '新規タスク' } } }

  assert.deepEqual(fill({ 'New task': { localizations: byHand } }), { 'New task': '新規タスク' })
})

test('English that Desktop translates two ways is left for a person', () => {
  assert.deepEqual(fill({ Open: {} }), { Open: undefined })
})

test('a literal percent sign next to an argument is left for a person', () => {
  assert.deepEqual(fill({ '%lld%% left': {} }), { '%lld%% left': undefined })
})

test('a string marked as not translatable is skipped', () => {
  assert.deepEqual(fill({ 'New task': { shouldTranslate: false } }), { 'New task': undefined })
})

test('the catalog is written the way Xcode writes it', () => {
  assert.equal(
    catalogJSON({ sourceLanguage: 'en', strings: { 'New task': {} } }),
    '{\n  "sourceLanguage" : "en",\n  "strings" : {\n    "New task" : {\n\n    }\n  }\n}',
  )
})
