import assert from 'node:assert/strict'
import test from 'node:test'

import { starterInstructions } from './starter-instructions.ts'

const base = { locale: 'en', connectorNames: ['Linear'], template: 'TEMPLATE' }

test('a Bot on the free computer hears about the starter Box and its trial', () => {
  const text = starterInstructions({ ...base, agentRuntime: 'opencode' })

  assert.match(text, /temporary starter Box with free AI trial credit/)
  assert.match(text, /continue beyond the trial/)
  assert.match(text, /Connector interests: Linear\./)
  assert.match(text, /TEMPLATE/)
})

for (const agentRuntime of ['claude-code', 'codex']) {
  test(`a Bot on the user's own ${agentRuntime} hears nothing of a Box or a trial`, () => {
    const text = starterInstructions({ ...base, agentRuntime })

    assert.doesNotMatch(text, /\bBox\b|trial|credit/i)
    assert.match(text, /Connector interests: Linear\./)
    assert.match(text, /small read-only task/)
    assert.match(text, /TEMPLATE/)
  })
}

test('the language note follows the onboarding locale', () => {
  assert.match(starterInstructions({ ...base, locale: 'zh-TW', agentRuntime: 'codex' }), /繁體中文/)
  assert.match(
    starterInstructions({ ...base, locale: 'ja', agentRuntime: 'opencode' }),
    /The user selected Japanese/,
  )
})
