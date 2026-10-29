import assert from 'node:assert/strict'
import test from 'node:test'

// The locale is read once at load, so pick Japanese before the first import.
Object.assign(globalThis, {
  window: { addEventListener() {} },
  localStorage: { getItem: () => 'ja' },
})
const { t } = await import('./index.ts')
const { sanitizeReportText } = await import('../lib/reportRedaction.ts')

test('error reports carry the English key, not the translation', () => {
  const shown = t('Failed to remove {name}', { name: 'Alex' })

  assert.notEqual(shown, 'Failed to remove Alex')
  assert.equal(sanitizeReportText(shown), 'Failed to remove {name}')
  assert.equal(sanitizeReportText('backend said no'), 'backend said no')
})
