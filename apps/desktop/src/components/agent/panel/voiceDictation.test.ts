import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_LEVELS,
  appendLevel,
  dictationInsert,
  dictationText,
  formatElapsed,
  isVoiceShortcut,
  levelFromSamples,
  openMicrophone,
  recordingFilename,
  recordingMimeType,
  waveformBars,
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

test('a take given up during the permission prompt stops the microphone it gets', async () => {
  const stopped: string[] = []
  const stream = { getTracks: () => [{ stop: () => stopped.push('mic') }] }
  let abandoned = false
  const later = openMicrophone(
    async () => {
      abandoned = true // the composer closed while the prompt was open

      return stream
    },
    () => abandoned,
  )

  assert.equal(await later, null)
  assert.deepEqual(stopped, ['mic'])
  assert.equal(
    await openMicrophone(
      async () => stream,
      () => false,
    ),
    stream,
  )
  assert.deepEqual(stopped, ['mic'])
})

test('writes a Chinese transcript in Traditional characters, as the mobile apps do', async () => {
  const chinese = { text: '我们为什么在这里', language: 'chinese' }

  assert.equal(await dictationText(chinese, 'zh-TW'), '我們為什麼在這裡')
  assert.equal(await dictationText(chinese, 'en'), '我們為什麼在這裡')
  assert.equal(await dictationText(chinese, 'zh-CN'), '我们为什么在这里')
  assert.equal(await dictationText({ text: 'ship it', language: 'english' }, 'zh-TW'), 'ship it')
  assert.equal(await dictationText({ text: '这里', language: null }, 'zh-TW'), '这里')
})

test('silence reads as level 0 and a full-scale signal as nearly 1', () => {
  assert.equal(levelFromSamples(new Uint8Array(64).fill(128)), 0)
  assert.equal(levelFromSamples([]), 0)
  assert.ok(levelFromSamples(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 0 : 255))) > 0.99)
  // About -40 dB: a fifth of the way up from the -50 dB floor.
  const quiet = levelFromSamples(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 127 : 129)))

  assert.ok(quiet > 0.1 && quiet < 0.2, String(quiet))
})

test('a take keeps only its newest levels', () => {
  let levels: number[] = []

  for (let i = 0; i < MAX_LEVELS + 5; i++) levels = appendLevel(levels, i)
  assert.equal(levels.length, MAX_LEVELS)
  assert.equal(levels[0], 5)
  assert.equal(levels.at(-1), MAX_LEVELS + 4)
})

test('the waveform puts the newest levels at the right and fills the rest with the baseline', () => {
  assert.deepEqual(waveformBars([0.2, 0.4], 4), [null, null, 0.2, 0.4])
  assert.deepEqual(waveformBars([0.1, 0.2, 0.3], 2), [0.2, 0.3])
  assert.deepEqual(waveformBars([0.5], 0), [])
})
