import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appendSteering, parseSteeringPart, steeringMessage } from './steering.ts'

import type { Tab } from './model.ts'
import type { SteeringPart } from './parts.ts'

test('a steering receipt with no assistant message to join is shown once, on its own', () => {
  const receipt: SteeringPart = { type: 'data-steering', data: { id: 's', text: 'wait' } }
  const tab = {
    messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'go' }] }],
  } as unknown as Tab
  const once = appendSteering(tab, receipt)

  assert.deepEqual(once.messages.at(-1), { id: 's', role: 'assistant', parts: [receipt] })
  assert.equal(appendSteering(once, receipt), once)
})

const upload = {
  type: 'transfer-upload',
  groupId: '0123456789abcdef01234567',
  status: 'ready',
  files: [{ fileName: 'shot.png', size: null, status: 'ready' }],
}

test('a steering receipt with files shows them as an upload card, not their names', () => {
  const part = parseSteeringPart({
    type: 'data-steering',
    data: { id: upload.groupId, text: 'Look\n\n[Attached: shot.png]', upload },
  })

  assert.ok(part)
  assert.deepEqual(steeringMessage(part.data).parts, [{ type: 'text', text: 'Look' }, upload])
  assert.deepEqual(
    steeringMessage({
      id: upload.groupId,
      text: '[Attached: shot.png]',
      upload: part.data.upload,
    }).parts,
    [upload],
  )
})

test('a text-only steering receipt stays text', () => {
  assert.deepEqual(steeringMessage({ id: 'm', text: 'a\n\nb' }).parts, [
    { type: 'text', text: 'a\n\nb' },
  ])
})
