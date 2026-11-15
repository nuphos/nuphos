import assert from 'node:assert/strict'
import test from 'node:test'

import { catalogJSON, desktopTranslator, fillCatalog, fillStrings } from './fill-mobile-locales.mjs'

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

const android = (strings, localized = '') =>
  fillStrings(`<resources>\n${strings}\n</resources>\n`, localized, ja).xml

test('an Android string takes the Desktop translation, in the order of the source', () => {
  assert.equal(
    android(
      '    <string name="only_phone">Only on the phone</string>\n    <string name="new_task">New task</string>',
    ),
    '<resources>\n    <string name="new_task">新しいタスク</string>\n</resources>\n',
  )
})

test('Android placeholders are numbered in the order the translation needs', () => {
  assert.equal(
    android('<string name="answered">Asked %1$s · Answered %2$s</string>'),
    '<resources>\n    <string name="answered">%2$sに回答 · %1$sに質問</string>\n</resources>\n',
  )
})

test('an Android translation written by hand is kept, and one no longer in the source is dropped', () => {
  assert.equal(
    android(
      '<string name="new_task">New task</string>',
      '<resources>\n    <string name="new_task">新規タスク</string>\n    <string name="gone">古い</string>\n</resources>\n',
    ),
    '<resources>\n    <string name="new_task">新規タスク</string>\n</resources>\n',
  )
})

test('Android plurals, escaped percent signs and untranslatable strings are left for a person', () => {
  assert.equal(
    android(
      '<string name="app" translatable="false">New task</string>\n' +
        '<string name="left">%1$d%% left</string>\n' +
        '<plurals name="tasks"><item quantity="other">New task</item></plurals>',
    ),
    '<resources>\n</resources>\n',
  )
})
