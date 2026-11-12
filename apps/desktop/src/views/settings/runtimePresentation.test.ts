import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runtimeRemovalDescription } from './runtimePresentation.ts'

import type { RuntimeInstance } from '../../types/runtime.ts'

const added = (online: boolean | undefined): RuntimeInstance => ({
  id: 'local_owner_box_codex_11111111-1111-4111-8111-111111111111',
  kind: 'local',
  provider: 'codex',
  label: 'Codex',
  status: 'active',
  createdAt: '',
  local: {
    deviceId: 'box',
    deviceLabel: 'MacBook Air',
    ownerUserId: 'owner',
    signedIn: true,
    instanceId: '11111111-1111-4111-8111-111111111111',
    ...(online === undefined ? {} : { online }),
  },
})

test('removing an offline computer’s agent says the computer deletes it when it is back', () => {
  const description = runtimeRemovalDescription(added(false))

  assert.match(description, /MacBook Air is offline/)
  assert.match(description, /next time it connects/)
})

test('removing an online computer’s agent keeps the immediate wording', () => {
  for (const online of [true, undefined]) {
    assert.equal(
      runtimeRemovalDescription(added(online)),
      'This removes the agent and its sign-in from MacBook Air. Your conversation history stays in Nuphos.',
    )
  }
})

test("removing a person's own default agent says only Nuphos forgets it", () => {
  const own: RuntimeInstance = {
    ...added(false),
    id: 'local_owner_box_codex',
    label: 'Codex',
    local: {
      deviceId: 'box',
      deviceLabel: 'MacBook Air',
      ownerUserId: 'owner',
      signedIn: false,
      online: false,
    },
  }

  assert.equal(
    runtimeRemovalDescription(own),
    'This removes Codex from Nuphos. Its CLI sign-in on MacBook Air is yours and stays; while it is signed in there, Codex is listed again.',
  )
})
