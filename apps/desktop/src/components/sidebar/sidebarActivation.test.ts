import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sidebarActivation } from './sidebarActivation.ts'

test('rapid switches only activate the final conversation, and returning to the current one cancels activation', async () => {
  const activation = sidebarActivation(10)
  const opened: string[] = []
  const open = (target: string) => activation.schedule('bot:a', target, () => opened.push(target))

  open('task:b')
  open('bot:a')
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.deepEqual(opened, [])
  open('task:b')
  open('task:c')
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.deepEqual(opened, ['task:c'])
  open('task:d')
  activation.cancel()
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.deepEqual(opened, ['task:c'])
})
