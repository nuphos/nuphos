import { expect, test } from 'bun:test'

import { buildTurnRulesMessage } from './chat-system-messages'

test('a user request stays a to-do until the user closes it', () => {
  const rules = buildTurnRulesMessage()

  expect(rules).toContain(
    'add every request from the user to it first, unless it is a simple topic you can finish within this turn',
  )
  expect(rules).toContain(
    'Keep it open until the user explicitly says the task is done or no longer needs following up; only then mark it done.',
  )
  expect(rules).not.toContain('tidy it as a turn ends')
})
