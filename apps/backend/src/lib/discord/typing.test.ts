import { expect, test } from 'bun:test'

import { startDiscordTyping } from './typing'

test('typing pulses immediately, renews, and clears its timer on completion', async () => {
  let count = 0
  let cleared = false
  let pulse = () => {}
  const stop = startDiscordTyping('thread', {
    send: () => {
      count++

      return Promise.resolve()
    },
    repeat: (callback) => {
      pulse = callback

      return () => {
        cleared = true
      }
    },
  })

  expect(count).toBe(1)
  await Promise.resolve()
  pulse()
  expect(count).toBe(2)
  stop()
  expect(cleared).toBe(true)
})

test('typing failures are best effort and do not block future pulses', async () => {
  let count = 0
  let pulse = () => {}
  const stop = startDiscordTyping('thread', {
    send: () => {
      count++

      return Promise.reject(new Error('Discord unavailable'))
    },
    repeat: (callback) => {
      pulse = callback

      return () => {}
    },
  })

  await Promise.resolve()
  pulse()
  expect(count).toBe(2)
  stop()
})
