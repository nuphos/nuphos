import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chooseAgent, parseNewChatChoice } from './newChatChoice.ts'

test('the model and effort picked for a new chat are saved with its agent', () => {
  const saved = JSON.stringify({ runtimeId: 'claude', pick: { model: 'opus', effort: 'high' } })

  assert.deepEqual(parseNewChatChoice(saved), {
    runtimeId: 'claude',
    pick: { model: 'opus', effort: 'high' },
  })
})

test('an agent id saved by an earlier build still selects that agent', () => {
  assert.deepEqual(parseNewChatChoice('dd0af1d5-33fc-43a0-a9cf-5d29dfc6545f'), {
    runtimeId: 'dd0af1d5-33fc-43a0-a9cf-5d29dfc6545f',
  })
  assert.equal(parseNewChatChoice(null), undefined)
  assert.equal(parseNewChatChoice('{not json'), undefined)
  assert.equal(parseNewChatChoice('{"pick":{}}'), undefined)
})

test('re-choosing the same agent keeps its picks; another agent starts from its defaults', () => {
  const choice = { runtimeId: 'claude', pick: { model: 'opus', effort: 'high' } }

  assert.equal(chooseAgent(choice, 'claude'), choice)
  assert.deepEqual(chooseAgent(choice, 'codex'), { runtimeId: 'codex' })
  assert.deepEqual(chooseAgent(undefined, 'codex'), { runtimeId: 'codex' })
})
