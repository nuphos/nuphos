import type { Act } from './flow/shared.ts'

/**
 * Off: sign in → name a team (or join one) → home. On: the intro demo, the
 * security briefing, the Slack step and the first-run cloud connect come back.
 */
export const ONBOARDING_EXTRA_STEPS_ENABLED = false

export function openingAct(step: number, extraSteps = ONBOARDING_EXTRA_STEPS_ENABLED): Act {
  return extraSteps && step === 1 ? 'intro' : 'chat'
}

/** What follows creating or joining a team. */
export function afterWorkspace(extraSteps = ONBOARDING_EXTRA_STEPS_ENABLED): 'security' | 'finish' {
  return extraSteps ? 'security' : 'finish'
}
