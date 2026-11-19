import assert from 'node:assert/strict'
import { test } from 'node:test'

import { saveBotIdentity } from './saveBotIdentity.ts'

test('saves an avatar-only edit even when the name is unchanged', async () => {
  const calls: string[] = []

  await saveBotIdentity('Lead', 'Lead', '07-ada', '16-athena', {
    rename: async (name) => {
      calls.push(`name:${name}`)
    },
    setAvatar: async (avatar) => {
      calls.push(`avatar:${avatar}`)
    },
  })
  assert.deepEqual(calls, ['avatar:16-athena'])
})

test('saves both fields and skips an unchanged photo', async () => {
  const calls: string[] = []
  const actions = {
    rename: async (name: string) => {
      calls.push(`name:${name}`)
    },
    setAvatar: async (avatar: string) => {
      calls.push(`avatar:${avatar}`)
    },
  }

  await saveBotIdentity('Lead', ' New Lead ', '07-ada', '16-athena', actions)
  assert.deepEqual(calls, ['name:New Lead', 'avatar:16-athena'])
  calls.length = 0
  await saveBotIdentity('Lead', 'Lead', 'photo-url', undefined, actions)
  assert.deepEqual(calls, [])
})

test('rejects a failed avatar save so the editor stays open for retry', async () => {
  await assert.rejects(
    saveBotIdentity('Lead', 'Lead', '07-ada', '16-athena', {
      rename: async () => {
        assert.fail('unchanged name must not be saved')
      },
      setAvatar: async () => {
        throw new Error('save failed')
      },
    }),
    /save failed/,
  )
})

test('renaming a photo Bot keeps its photo and blank names cannot save', async () => {
  const names: string[] = []
  const actions = {
    rename: async (name: string) => {
      names.push(name)
    },
    setAvatar: async () => {
      assert.fail('photo must be preserved')
    },
  }

  await saveBotIdentity('Lead', 'New Lead', 'photo-url', undefined, actions)
  await saveBotIdentity('Lead', '   ', 'photo-url', '07-ada', actions)
  assert.deepEqual(names, ['New Lead'])
})
