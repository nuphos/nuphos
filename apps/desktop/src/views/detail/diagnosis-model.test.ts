import assert from 'node:assert/strict'
import test from 'node:test'

import { diagnose } from '../../lib/kube-insight.ts'

import { APP_UI_LOCALE, diagnosisView } from './diagnosis-model.ts'

import type { Pod } from '../../lib/kube-insight.ts'

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

test('the card follows the app UI language, not the OS language', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'zh-TW', languages: ['zh-TW', 'zh-Hant'] },
    configurable: true,
  })
  try {
    const [found] = diagnose({ pods: [crashing], events: [] })
    const view = diagnosisView(APP_UI_LOCALE, found)

    assert.equal(APP_UI_LOCALE, 'en')
    assert.equal(view.cause, 'api keeps crashing (exit code 1).')
    assert.equal(view.severityLabel, 'Critical')
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})
