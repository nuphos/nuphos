import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nuphosStreamReplyImages } from '../image/reply-image-stream.mjs'

test('split image syntax is the only held text and trailing prose resumes immediately', async () => {
  const state = {},
    calls = []
  const upload = async (text) => {
    calls.push(text)
    return '<image>'
  }
  assert.equal(await nuphosStreamReplyImages('Done! Here is !', state, upload), 'Done! Here is ')
  assert.equal(await nuphosStreamReplyImages('[a](<image', state, upload), '')
  assert.equal(
    await nuphosStreamReplyImages(' name.png>) and more text', state, upload),
    '<image> and more text',
  )
  assert.deepEqual(calls, ['![a](<image name.png>)'])
})

test('fences, inline ticks and escapes remain effective across every possible chunk boundary', async () => {
  const source =
    'Before! `![code](private.png)` and \\![escaped](private.png)\n```md\n![fenced](private.png)\n```\n![real](image.png) after'
  for (let split = 0; split <= source.length; split++) {
    const state = {},
      calls = []
    const upload = async (text) => {
      calls.push(text)
      return '<image>'
    }
    const result =
      (await nuphosStreamReplyImages(source.slice(0, split), state, upload)) +
      (await nuphosStreamReplyImages(source.slice(split), state, upload)) +
      (await nuphosStreamReplyImages('', state, upload, true))
    assert.equal(result, source.replace('![real](image.png)', '<image>'), `split ${split}`)
    assert.deepEqual(calls, ['![real](image.png)'], `split ${split}`)
  }
})

test('incomplete Markdown is released at completion and image limits span chunks', async () => {
  const state = {},
    calls = []
  const upload = async (text) => {
    calls.push(text)
    return '<image>'
  }
  for (let i = 0; i < 10; i++) await nuphosStreamReplyImages('![a](image.png) ', state, upload)
  assert.equal(calls.length, 8)
  assert.equal(await nuphosStreamReplyImages('unfinished ![alt', state, upload), 'unfinished ')
  assert.equal(await nuphosStreamReplyImages('', state, upload, true), '![alt')
})
