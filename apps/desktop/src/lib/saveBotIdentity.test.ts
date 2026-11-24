import assert from 'node:assert/strict'
import { test } from 'node:test'

import { saveBotIdentity } from './saveBotIdentity.ts'

function recorder() {
  const calls: string[] = []

  return {
    calls,
    actions: {
      rename: async (name: string) => {
        calls.push(`name:${name}`)
      },
      setAvatar: async (avatar: string, background: string) => {
        calls.push(`avatar:${avatar}:${background}`)
      },
    },
  }
}

const ada = { avatar: '07-ada', background: 'none' }

test('saves an avatar-only edit even when the name is unchanged', async () => {
  const { calls, actions } = recorder()

  await saveBotIdentity('Lead', 'Lead', ada, { avatar: '16-athena', background: 'none' }, actions)
  assert.deepEqual(calls, ['avatar:16-athena:none'])
})

test('saves a background-only edit on the same character', async () => {
  const { calls, actions } = recorder()

  await saveBotIdentity('Lead', 'Lead', ada, { avatar: '07-ada', background: 'mint' }, actions)
  assert.deepEqual(calls, ['avatar:07-ada:mint'])
  calls.length = 0
  await saveBotIdentity('Lead', 'Lead', { avatar: '07-ada', background: 'mint' }, ada, actions)
  assert.deepEqual(calls, ['avatar:07-ada:none'])
})

test('saves both fields and skips an unchanged face or photo', async () => {
  const { calls, actions } = recorder()

  await saveBotIdentity(
    'Lead',
    ' New Lead ',
    ada,
    { avatar: '16-athena', background: 'sky' },
    actions,
  )
  assert.deepEqual(calls, ['name:New Lead', 'avatar:16-athena:sky'])
  calls.length = 0
  await saveBotIdentity('Lead', 'Lead', ada, ada, actions)
  await saveBotIdentity(
    'Lead',
    'Lead',
    { avatar: 'photo-url', background: 'none' },
    { avatar: undefined, background: 'mint' },
    actions,
  )
  assert.deepEqual(calls, [])
})

test('rejects a failed avatar save so the editor stays open for retry', async () => {
  await assert.rejects(
    saveBotIdentity(
      'Lead',
      'Lead',
      ada,
      { avatar: '16-athena', background: 'none' },
      {
        rename: async () => {
          assert.fail('unchanged name must not be saved')
        },
        setAvatar: async () => {
          throw new Error('save failed')
        },
      },
    ),
    /save failed/,
  )
})

test('renaming a photo Bot keeps its photo and blank names cannot save', async () => {
  const names: string[] = []
  const photo = { avatar: 'photo-url', background: 'none' }
  const actions = {
    rename: async (name: string) => {
      names.push(name)
    },
    setAvatar: async () => {
      assert.fail('photo must be preserved')
    },
  }

  await saveBotIdentity(
    'Lead',
    'New Lead',
    photo,
    { avatar: undefined, background: 'none' },
    actions,
  )
  await saveBotIdentity('Lead', '   ', photo, ada, actions)
  assert.deepEqual(names, ['New Lead'])
})
