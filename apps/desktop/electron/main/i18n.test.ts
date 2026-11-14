import assert from 'node:assert/strict'
import test from 'node:test'

import { parseLocale, setMessages, systemLocale, t } from './i18n.ts'

test('menu text is English until a language is loaded, then translated', () => {
  setMessages({})
  assert.equal(t('Quit {app}', { app: 'Nuphos' }), 'Quit Nuphos')
  setMessages({ 'Quit {app}': '結束 {app}' })
  assert.equal(t('Quit {app}', { app: 'Nuphos' }), '結束 Nuphos')
  assert.equal(t('Hide Others'), 'Hide Others')
  setMessages({})
})

test('only a supported language is accepted from a window', () => {
  assert.equal(parseLocale('zh-TW'), 'zh-TW')
  assert.equal(parseLocale('en'), 'en')
  for (const value of ['fr', '', null, 42]) assert.throws(() => parseLocale(value), /Invalid/u)
})

test('with nothing saved, the first supported system language wins', () => {
  assert.equal(systemLocale(['fr-FR', 'zh-Hant-TW', 'en-US']), 'zh-TW')
  assert.equal(systemLocale(['fr-FR']), 'en')
  assert.equal(systemLocale([]), 'en')
})
