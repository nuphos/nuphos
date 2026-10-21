import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import {
  boxPaywall,
  boxPaywallLimitRead,
  openBoxPaywall,
  openBoxPlans,
  paywallAudience,
} from './boxPaywallStore.ts'

import type { TeamMember } from '../../types'

// The IPC layer carries a backend error's code under this sentinel (api/errors.ts).
const refusal = (code: string) =>
  new Error(
    `__ATLAS_API_ERROR__${JSON.stringify({ code, message: 'Your team has no Box plan; upgrade to start a Box' })}`,
  )

afterEach(() => boxPaywall.close())

test('only the plan refusal opens the paywall; anything else is left to the caller', () => {
  assert.equal(
    openBoxPaywall('t1', refusal('box_starting'), () => {}),
    false,
  )
  assert.equal(
    openBoxPaywall('t1', new Error('network down'), () => {}),
    false,
  )
  assert.equal(boxPaywall.current(), null)

  assert.equal(
    openBoxPaywall('t1', refusal('box_vcpu_limit'), () => {}),
    true,
  )
  assert.equal(boxPaywall.current()?.teamId, 't1')
  assert.match(boxPaywall.current()?.message ?? '', /no Box plan/)
})

test('after a plan is bought, the paywall closes and the refused start runs once', () => {
  let retried = 0

  openBoxPaywall('t1', refusal('box_vcpu_limit'), () => {
    retried += 1
  })
  boxPaywallLimitRead(0) // the limit as the paywall opens
  boxPaywallLimitRead(0) // Checkout open, webhook not in yet
  assert.equal(retried, 0)
  assert.notEqual(boxPaywall.current(), null)

  boxPaywallLimitRead(12) // paid
  assert.equal(retried, 1)
  assert.equal(boxPaywall.current(), null)

  boxPaywallLimitRead(12) // later reads do nothing once closed
  assert.equal(retried, 1)
})

test('an upgrade past the current plan retries too; closing without paying never does', () => {
  let retried = 0
  const retry = () => {
    retried += 1
  }

  openBoxPaywall('t1', refusal('box_vcpu_limit'), retry)
  boxPaywallLimitRead(4)
  boxPaywallLimitRead(24)
  assert.equal(retried, 1)

  openBoxPaywall('t1', refusal('box_vcpu_limit'), retry)
  boxPaywallLimitRead(0)
  boxPaywall.close()
  boxPaywallLimitRead(12)
  assert.equal(retried, 1)
})

const member = (id: string, role: TeamMember['role'], name: string) =>
  ({ id, role, name, email: `${id}@example.test`, username: id, joinedAt: '' }) as TeamMember

test('a member who is not an administrator is told which administrators can upgrade', () => {
  const members = [
    member('u1', 'ADMINISTRATOR', 'Ada'),
    member('u2', 'EDITOR', 'Bo'),
    member('u3', 'ADMINISTRATOR', 'Cy'),
  ]

  const editor = paywallAudience(members, 'u2')

  assert.equal(editor.isAdmin, false)
  assert.deepEqual(
    editor.admins.map((admin) => admin.name),
    ['Ada', 'Cy'],
  )
  assert.equal(paywallAudience(members, 'u3').isAdmin, true)
  assert.equal(paywallAudience([], 'u1').isAdmin, false)
})

test('a size the plan cannot fit opens the plans directly, with its own note for after paying', () => {
  let picked = 0

  openBoxPlans(
    't1',
    'Large needs 8 vCPU',
    () => {
      picked += 1
    },
    { afterPaid: 'It is selected for you.', needs: 16 },
  )
  assert.equal(boxPaywall.current()?.message, 'Large needs 8 vCPU')
  assert.equal(boxPaywall.current()?.afterPaid, 'It is selected for you.')
  assert.equal(boxPaywall.current()?.needs, 16)
  boxPaywall.current()?.retry()
  assert.equal(picked, 1)
})
