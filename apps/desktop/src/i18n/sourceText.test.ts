import assert from 'node:assert/strict'
import test from 'node:test'

// The locale is read once at load, so pick Japanese before the first import.
Object.assign(globalThis, {
  window: { addEventListener() {} },
  localStorage: { getItem: () => 'ja' },
})
const { t } = await import('./index.ts')
const { sanitizeReportText } = await import('../lib/reportRedaction.ts')

test('error reports carry the English text, not the translation', () => {
  const shown = t('Failed to remove {name}', { name: 'Alex' })

  assert.notEqual(shown, 'Failed to remove Alex')
  assert.equal(sanitizeReportText(shown), 'Failed to remove Alex')
  assert.equal(sanitizeReportText('backend said no'), 'backend said no')
})

test('the error inside a repeated-failure message survives', () => {
  const key =
    "{error} (This has failed {count} times in a row — retrying the same way won't help. If it persists, reopen this agent or continue in a new one.)"
  const shown = t(key, { error: 'socket closed', count: 3 })

  assert.equal(
    sanitizeReportText(shown),
    "socket closed (This has failed 3 times in a row — retrying the same way won't help. If it persists, reopen this agent or continue in a new one.)",
  )
})

test('translated text inside another message is reported in English too', () => {
  const shown = t('{action}: {n} failed', { action: t('Restart pods'), n: 2 })

  assert.equal(sanitizeReportText(shown), 'Restart pods: 2 failed')
})
