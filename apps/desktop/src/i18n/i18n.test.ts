import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { MESSAGES, matchLocale, t } from './index.ts'

const SRC = join(import.meta.dirname, '..')

/** Every literal passed to t() in the app, unescaped to its runtime value. */
function scan(): { keys: Set<string>; dynamic: string[] } {
  const keys = new Set<string>()
  const dynamic: string[] = []
  const call = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g

  for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue
    if (entry.parentPath === import.meta.dirname) continue
    const source = readFileSync(join(entry.parentPath, entry.name), 'utf8')

    for (const m of source.matchAll(call)) {
      keys.add(m[2].replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c)))
    }
    // A key this test cannot read could go missing from a locale unnoticed.
    if (/\bt\(\s*[^'"\s]/.test(source)) dynamic.push(entry.name)
  }

  return { keys, dynamic }
}

const { keys: used, dynamic } = scan()

const placeholders = (s: string) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort()

test('t() is only called with a string literal', () => {
  assert.deepEqual(dynamic, [])
})

test('every locale translates exactly the strings the app uses', () => {
  for (const [code, messages] of Object.entries(MESSAGES)) {
    const missing = [...used].filter((k) => !(k in messages))
    const stale = Object.keys(messages).filter((k) => !used.has(k))

    assert.deepEqual(missing, [], `${code} is missing translations`)
    assert.deepEqual(stale, [], `${code} has translations no longer used`)
    for (const [key, value] of Object.entries(messages)) {
      assert.deepEqual(placeholders(value), placeholders(key), `${code}: placeholders in "${key}"`)
    }
  }
})

test('t falls back to English and fills placeholders', () => {
  assert.equal(t('Not a real key {n}', { n: 3 }), 'Not a real key 3')
  assert.equal(t('Open|state'), 'Open')
})

test('matchLocale maps system languages to supported locales', () => {
  assert.equal(matchLocale('zh-TW'), 'zh-TW')
  assert.equal(matchLocale('zh-Hant-HK'), 'zh-TW')
  assert.equal(matchLocale('zh-HK'), 'zh-TW')
  assert.equal(matchLocale('zh-CN'), 'zh-CN')
  assert.equal(matchLocale('zh'), 'zh-CN')
  assert.equal(matchLocale('ja-JP'), 'ja')
  assert.equal(matchLocale('es-419'), 'es')
  assert.equal(matchLocale('id-ID'), 'id')
  assert.equal(matchLocale('fr-FR'), undefined)
})
