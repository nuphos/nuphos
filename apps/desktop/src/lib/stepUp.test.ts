import assert from 'node:assert/strict'
import { test } from 'node:test'

import { onStepUp, withStepUp } from './stepUp.ts'

const reauth = () =>
  new Error(
    `__ATLAS_API_ERROR__${JSON.stringify({ message: 'Enter a code', code: 'reauth_required', details: { method: 'mfa' } })}`,
  )

test('a call that needs a code asks once, then runs again', async () => {
  let calls = 0
  let asked = 0
  const api = withStepUp({
    deleteTeam: async () => {
      calls += 1
      if (calls === 1) throw reauth()

      return 'deleted'
    },
  })

  onStepUp(async () => {
    asked += 1

    return true
  })
  assert.equal(await api.deleteTeam(), 'deleted')
  assert.equal(asked, 1)
  assert.equal(calls, 2)
})

test('cancelling the prompt keeps the original failure', async () => {
  const api = withStepUp({
    deleteTeam: async () => {
      throw reauth()
    },
  })

  onStepUp(async () => false)
  await assert.rejects(api.deleteTeam(), /reauth_required/)
})

test('calls that need a code together share one prompt', async () => {
  let asked = 0
  const failedOnce = new Set<string>()
  const api = withStepUp({
    run: async (name: unknown) => {
      if (!failedOnce.has(String(name))) {
        failedOnce.add(String(name))
        throw reauth()
      }

      return name
    },
  })

  onStepUp(async () => {
    asked += 1
    await new Promise((resolve) => setTimeout(resolve, 10))

    return true
  })
  assert.deepEqual(await Promise.all([api.run('a'), api.run('b')]), ['a', 'b'])
  assert.equal(asked, 1)
})

test('other failures pass through untouched', async () => {
  let asked = 0
  const api = withStepUp({
    load: async () => {
      throw new Error('offline')
    },
  })

  onStepUp(async () => {
    asked += 1

    return true
  })
  await assert.rejects(api.load(), /offline/)
  assert.equal(asked, 0)
})
