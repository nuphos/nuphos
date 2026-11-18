import assert from 'node:assert/strict'
import { test } from 'node:test'

import { offlineMember, withBotPresence } from './botPresenceRuntime.ts'

import type { RuntimeInstance } from '../../types/runtime.ts'

const mac = {
  id: 'local_owner_mac_claude-code',
  local: { online: true, signedIn: true, deviceId: 'mac' },
} as unknown as RuntimeInstance
const other = { id: 'cloud-1' } as unknown as RuntimeInstance
const local = (instances: RuntimeInstance[]) => instances[0]?.local

test("an offline or signed-out Bot's computer reads so on its runtime, and only there", () => {
  const offline = withBotPresence([mac, other], mac.id, {
    state: 'offline',
    reason: 'computer_offline',
  })

  assert.equal(local(offline)?.online, false)
  assert.equal(offline[1], other)
  assert.equal(
    local(withBotPresence([mac], mac.id, { state: 'offline', reason: 'sign_in_required' }))
      ?.signedIn,
    false,
  )
})

test('an online or busy Bot, or a reason the strip does not carry, leaves the runtimes as listed', () => {
  const instances = [mac, other]

  for (const presence of [
    { state: 'online' },
    { state: 'busy' },
    { state: 'offline', reason: 'usage_limit' },
    undefined,
  ] as const)
    assert.equal(withBotPresence(instances, mac.id, presence), instances)
})

test('a group chat names a member Bot whose computer is offline, and no other', () => {
  const agents = [
    { sessionId: 'a', title: 'Atlas', ownerId: 'o', presence: { state: 'busy' } },
    {
      sessionId: 's',
      title: 'Scribe',
      ownerId: 'o',
      presence: { state: 'offline', reason: 'computer_offline' },
    },
  ] as never

  assert.equal(offlineMember(agents), 'Scribe')
  assert.equal(offlineMember([agents[0]] as never), undefined)
})
