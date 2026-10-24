import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { createPlayOnce, imageMotion, withBotAvatarMotion } from './botAvatarMotion.ts'
import { BOT_AVATARS } from './botAvatars.ts'

const settle = () => new Promise((resolve) => setImmediate(resolve))

/** Timers and URLs the tests do not need to clean up. */
function keepTimer(): void {
  // Nothing to cancel or free in a test.
}

function shipped(file: string): string {
  return readFileSync(new URL(`../../public/bot-avatars/${file}`, import.meta.url), 'utf8')
}

test('every character marks one body and two eyes for the idle loop to move', () => {
  for (const file of BOT_AVATARS) {
    const svg = shipped(file)

    assert.equal(svg.match(/<g class="bot-body">/g)?.length, 1, file)
    assert.equal(svg.match(/<g class="bot-eye">/g)?.length, 2, file)
    assert.doesNotMatch(svg, /<style/, `${file} stays still until the app animates it`)
  }
})

test('the animated copy adds one style block and starts each character at its own point', () => {
  const delays = new Set<string>()

  for (const file of BOT_AVATARS) {
    const svg = shipped(file)
    const animated = withBotAvatarMotion(svg, file)

    assert.equal(animated.match(/<style>/g)?.length, 1, file)
    assert.match(animated, /viewBox="0 0 256 256" fill="none"><style>/, file)
    assert.equal(animated.replace(/<style>[\s\S]*<\/style>/, ''), svg, file)
    delays.add(/animation:bot-body 6s (-?[\d.]+)s/.exec(animated)?.[1] ?? '')
  }
  assert.equal(delays.size, BOT_AVATARS.length)
})

test('a hover copy plays the loop once from the start; a running copy repeats it', () => {
  for (const file of BOT_AVATARS) {
    const svg = shipped(file)
    const once = withBotAvatarMotion(svg, file, false)

    assert.match(once, /animation:bot-body 6s 0s 1}/, file)
    assert.match(once, /animation:bot-eye 6s 0s 1}/, file)
    assert.equal(once.replace(/<style>[\s\S]*<\/style>/, ''), svg, file)
    assert.match(withBotAvatarMotion(svg, file), /animation:bot-body 6s -?[\d.]+s infinite}/, file)
  }
})

test('characters are still by default, loop only when asked, and never move under reduce motion', () => {
  assert.equal(imageMotion({ reduceMotion: false, looping: false }), 'on-request')
  assert.equal(imageMotion({ reduceMotion: false, looping: true }), 'loop')
  assert.equal(imageMotion({ reduceMotion: true, looping: false }), 'still')
  assert.equal(imageMotion({ reduceMotion: true, looping: true }), 'still')
})

test('a hover plays the loop once, ignores repeats while playing, and plays again after', async () => {
  const shown: (string | undefined)[] = []
  const revoked: string[] = []
  const ends: (() => void)[] = []
  let built = 0
  const player = createPlayOnce(
    async () => `blob:${String(++built)}`,
    (url) => shown.push(url),
    {
      durationMs: 6000,
      revoke: (url) => revoked.push(url),
      schedule: (done) => {
        ends.push(done)

        return keepTimer
      },
    },
  )

  assert.deepEqual(shown, [], 'still until played')
  player.play()
  player.play()
  await settle()
  player.play()
  await settle()
  assert.deepEqual(shown, ['blob:1'], 'one play, however often the pointer re-enters')
  ends.shift()?.()
  assert.deepEqual(shown, ['blob:1', undefined], 'back to the still image after one loop')
  assert.deepEqual(revoked, ['blob:1'])
  player.play()
  await settle()
  assert.deepEqual(shown, ['blob:1', undefined, 'blob:2'], 'a new hover replays it')
  player.dispose()
  assert.deepEqual(revoked, ['blob:1', 'blob:2'], 'unmounting mid-play frees the copy')
})

test('a play whose copy could not load stays still and can try again', async () => {
  const shown: (string | undefined)[] = []
  let ok = false
  const player = createPlayOnce(
    async () => (ok ? 'blob:ok' : undefined),
    (url) => shown.push(url),
    { revoke: keepTimer, schedule: () => keepTimer },
  )

  player.play()
  await settle()
  assert.deepEqual(shown, [])
  ok = true
  player.play()
  await settle()
  assert.deepEqual(shown, ['blob:ok'])
})

test('disposing mid-play takes the revoked copy back, so it never shows as a broken image', async () => {
  const shown: (string | undefined)[] = []
  const revoked: string[] = []
  const player = createPlayOnce(
    async () => 'blob:playing',
    (url) => shown.push(url),
    { revoke: (url) => revoked.push(url), schedule: () => keepTimer },
  )

  player.play()
  await settle()
  // The character changes mid-play (a preview, a new pick): the image is disposed.
  player.dispose()
  assert.deepEqual(revoked, ['blob:playing'])
  assert.deepEqual(shown, ['blob:playing', undefined], 'the revoked URL is withdrawn')
  player.dispose()
  assert.deepEqual(shown, ['blob:playing', undefined], 'disposing twice changes nothing')
})
