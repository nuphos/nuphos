import assert from 'node:assert/strict'
import { test } from 'node:test'

import { afterWorkspace, ONBOARDING_EXTRA_STEPS_ENABLED, openingAct } from './onboardingSteps.ts'

test('by default onboarding opens on naming the team and lands home right after', () => {
  assert.equal(ONBOARDING_EXTRA_STEPS_ENABLED, false)
  assert.equal(openingAct(1), 'chat')
  assert.equal(afterWorkspace(), 'finish')
})

test('turning the extra steps on brings back the intro and the briefing', () => {
  assert.equal(openingAct(1, true), 'intro')
  assert.equal(openingAct(3, true), 'chat')
  assert.equal(afterWorkspace(true), 'security')
})
