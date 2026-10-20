import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BUILTIN_RULES, diagnose, FIX_KINDS, SEVERITIES } from './diagnose/index.ts'
import { CATALOGS, LOCALES, renderMessage, translate } from './i18n/index.ts'
import { HEALTH_STATUSES } from './status/index.ts'

import type { Pod } from './kube.ts'

const crashing: Pod = {
  metadata: { name: 'api-1' },
  spec: { containers: [{ name: 'api' }] },
  status: {
    phase: 'Running',
    containerStatuses: [
      {
        name: 'api',
        ready: false,
        restartCount: 3,
        state: { waiting: { reason: 'CrashLoopBackOff' } },
        lastState: { terminated: { reason: 'Error', exitCode: 1 } },
      },
    ],
  },
}

describe('rule registry', () => {
  it('has unique kebab-case ids, a known severity and fix kind, and https sources', () => {
    const ids = BUILTIN_RULES.map((r) => r.id)

    assert.equal(new Set(ids).size, ids.length)
    for (const rule of BUILTIN_RULES) {
      assert.match(rule.id, /^[a-z]+(-[a-z]+)*$/)
      assert.ok(SEVERITIES.includes(rule.severity))
      assert.ok(FIX_KINDS.includes(rule.fixKind))
      assert.ok(rule.sources.length > 0)
      for (const source of rule.sources) {
        assert.match(source.url, /^https:\/\//)
        assert.ok(source.title.length > 0)
      }
    }
  })

  it('lets a caller override a severity or disable a rule', () => {
    const [found] = diagnose(
      { pods: [crashing], events: [] },
      { severity: { 'crash-loop': 'info' } },
    )

    assert.equal(found.ruleId, 'crash-loop')
    assert.equal(found.severity, 'info')
    assert.deepEqual(diagnose({ pods: [crashing], events: [] }, { disabled: ['crash-loop'] }), [])
  })

  it('runs only the rules it is given', () => {
    assert.deepEqual(diagnose({ pods: [crashing], events: [] }, { rules: [] }), [])
  })
})

describe('i18n', () => {
  const uiKeys = [
    ...SEVERITIES.map((s) => `severity.${s}`),
    ...FIX_KINDS.map((k) => `fixKind.${k}`),
    ...HEALTH_STATUSES.map((s) => `status.${s}`),
  ]

  it('translates every rule message key and UI key in every locale', () => {
    for (const locale of LOCALES) {
      for (const key of [...BUILTIN_RULES.flatMap((r) => r.messageKeys), ...uiKeys])
        assert.ok(CATALOGS[locale][key] != null, `${locale} lacks ${key}`)
    }
  })

  it('keeps the same keys in every catalog', () => {
    const en = Object.keys(CATALOGS.en).sort()

    for (const locale of LOCALES) assert.deepEqual(Object.keys(CATALOGS[locale]).sort(), en)
  })

  it('fills placeholders and falls back to the key', () => {
    assert.equal(translate('en', 'card.more', { count: 2 }), '2 more')
    assert.equal(translate('en', 'no.such.key'), 'no.such.key')
    const [found] = diagnose({ pods: [crashing], events: [] })

    assert.equal(renderMessage('en', found.cause), 'api keeps crashing (exit code 1).')
  })
})
