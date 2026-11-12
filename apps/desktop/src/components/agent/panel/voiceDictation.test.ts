import assert from 'node:assert/strict'
import test from 'node:test'

import {
  dictationInsert,
  formatElapsed,
  isVoiceShortcut,
  recordingFilename,
  recordingMimeType,
} from './voiceDictation.ts'

test('picks the first container the recorder supports', () => {
  assert.equal(
    recordingMimeType(() => true),
    'audio/webm;codecs=opus',
  )
  assert.equal(
    recordingMimeType((type) => type.startsWith('audio/ogg')),
    'audio/ogg;codecs=opus',
  )
  assert.equal(
    recordingMimeType(() => false),
    undefined,
  )
  assert.equal(recordingFilename('audio/webm;codecs=opus'), 'dictation.webm')
  assert.equal(recordingFilename('audio/ogg;codecs=opus'), 'dictation.ogg')
})

test('formats the recording timer', () => {
  assert.equal(formatElapsed(0), '0:00')
  assert.equal(formatElapsed(65_400), '1:05')
  assert.equal(formatElapsed(-5), '0:00')
})

test('keeps a transcript off a preceding word and skips an empty one', () => {
  assert.equal(dictationInsert('  check the logs ', ''), 'check the logs')
  assert.equal(dictationInsert('check the logs', 'Please'), ' check the logs')
  assert.equal(dictationInsert('check the logs', 'Please '), 'check the logs')
  assert.equal(dictationInsert('看一下 log', '幫我'), ' 看一下 log')
  assert.equal(dictationInsert('   ', 'Please'), '')
})

test('the voice shortcut is mod+shift+U only', () => {
  const key = {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
    code: 'KeyU',
    isComposing: false,
  }

  assert.equal(isVoiceShortcut({ ...key, metaKey: true }, true), true)
  assert.equal(isVoiceShortcut({ ...key, ctrlKey: true }, false), true)
  assert.equal(isVoiceShortcut({ ...key, ctrlKey: true }, true), false)
  assert.equal(isVoiceShortcut({ ...key, metaKey: true, shiftKey: false }, true), false)
  assert.equal(isVoiceShortcut({ ...key, metaKey: true, isComposing: true }, true), false)
})
