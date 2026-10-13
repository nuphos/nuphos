import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseSteeringPart, steeringMessage } from './steering.ts'

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
