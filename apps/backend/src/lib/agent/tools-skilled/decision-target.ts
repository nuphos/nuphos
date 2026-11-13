import { isPersonalCredentialRef } from './decision-tools'

const CARD_TARGETS = new Map([
  ['credential', 'secretName'],
  ['integration', 'providers or credentials'],
])

/**
 * Why a request cannot become a card someone can answer: a credential is answered only in its
 * masked input and an integration only by selecting one, so each needs its target and takes no
 * `options` or `questions`; `credentials` takes only the member's own, never with `providers`.
 */
export function decisionTargetProblem(input: Record<string, unknown>): string | null {
  const target = CARD_TARGETS.get(String(input.category))
  const named = target?.split(' or ').some((field) => input[field] !== undefined)

  if (target && (!named || input.options !== undefined || input.questions !== undefined))
    return `A ${String(input.category)} question is answered only in its own card: give it ${target} and no options or questions, or ask the choice with another category.`
  if (input.credentials === undefined) return null
  if (!Array.isArray(input.credentials) || !input.credentials.every(isPersonalCredentialRef)) {
    return "`credentials` names only the member's own credential, {provider: 'personal', id: 'github' | 'linear'}; ask for team access with `providers`."
  }
  if (input.providers !== undefined) {
    return "Pass either `providers` (any access of that kind, a team binding included) or `credentials` (only the member's own), not both: ask one question per target."
  }

  return null
}
