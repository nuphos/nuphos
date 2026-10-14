import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_SLEEP_PREFERENCES,
  parseSleepPreferences,
  RuntimeTaskActivity,
  SleepPrevention,
} from './sleep-prevention.ts'

test('one assertion across concurrent tasks, power changes, sign-out and shutdown', () => {
  let battery = false
  let signedIn = true
  let starts = 0
  const stopped: number[] = []
  const activity = new RuntimeTaskActivity(() => {})
  const sleep = new SleepPrevention({
    supported: true,
    onBattery: () => battery,
    signedIn: () => signedIn,
    busy: () => activity.busy(),
    start: () => ++starts,
    stop: (id) => stopped.push(id),
  })

  assert.equal(sleep.state().reason, 'off')
  sleep.configure({ mode: 'tasks', onlyOnAC: true })
  activity.open('a', 'transport')
  activity.open('b', 'control')
  assert.equal(sleep.state().reason, 'idle')
  activity.data('a', '{"id":1,"method":"session/prompt"}', true)
  activity.data('a', '{"id":2,"method":"session/prompt"}', true)
  assert.equal(sleep.state().active, true)
  assert.equal(sleep.state().active, true)
  assert.equal(starts, 1)
  activity.data('a', '{"id":1,"result":{}}', false)
  assert.equal(sleep.state().active, true)
  battery = true
  assert.equal(sleep.state().reason, 'battery')
  battery = false
  assert.equal(sleep.state().active, true)
  activity.data('a', '{"id":2,"error":{"code":-1}}', false)
  assert.equal(sleep.state().reason, 'idle')
  sleep.configure({ mode: 'host', onlyOnAC: false })
  battery = true
  assert.equal(sleep.state().active, true)
  signedIn = false
  assert.equal(sleep.state().reason, 'signed-out')
  signedIn = true
  sleep.state()
  sleep.dispose()
  assert.equal(sleep.state().active, false)
  assert.deepEqual(stopped, [1, 2, 3, 4])
})

test('stream closure and disconnect clear task state; non-task sockets do not count', () => {
  const activity = new RuntimeTaskActivity(() => {})

  for (const purpose of ['control', 'file', 'transport']) activity.open(purpose, purpose)
  activity.data('transport', 'invalid', true)
  activity.data('transport', '{"id":1,"method":"session/new"}', true)
  assert.equal(activity.busy(), false)
  for (const purpose of ['exec', 'cua', 'terminal']) {
    activity.open(purpose, purpose)
    assert.equal(activity.busy(), true)
    activity.close(purpose)
    assert.equal(activity.busy(), false)
  }
  activity.data('transport', '{"id":"x","method":"session/prompt"}', true)
  assert.equal(activity.busy(), true)
  activity.clear()
  assert.equal(activity.busy(), false)
})

test('preferences validate at the IPC boundary and unsupported systems never start', () => {
  for (const value of [
    null,
    {},
    { mode: 'invalid', onlyOnAC: true },
    { mode: 'host', onlyOnAC: 'yes' },
  ])
    assert.throws(() => parseSleepPreferences(value))
  assert.deepEqual(parseSleepPreferences(DEFAULT_SLEEP_PREFERENCES), DEFAULT_SLEEP_PREFERENCES)
  const sleep = new SleepPrevention({
    supported: false,
    onBattery: () => false,
    signedIn: () => true,
    busy: () => true,
    start: () => {
      throw new Error('must not start')
    },
    stop: () => {},
  })

  sleep.configure({ mode: 'host', onlyOnAC: false })
  assert.equal(sleep.state().reason, 'unsupported')
})

test('activity broadcasts only on busy transitions, not tool RPCs or concurrent prompts', () => {
  let changes = 0
  const activity = new RuntimeTaskActivity(() => {
    changes += 1
  })

  activity.open('a', 'transport')
  activity.open('b', 'transport')
  activity.open('control', 'control')
  activity.data('a', '{"id":0,"method":"session/new"}', true)
  activity.data('a', '{"id":0,"result":{}}', false)
  assert.equal(changes, 0)
  activity.data('a', '{"id":1,"method":"session/prompt"}', true)
  assert.equal(changes, 1)
  activity.data('a', '{"id":2,"method":"fs/read_text_file"}', false)
  activity.data('a', '{"id":2,"result":{}}', true)
  activity.data('b', '{"id":1,"method":"session/prompt"}', true)
  activity.open('terminal', 'terminal')
  activity.data('a', '{"id":1,"result":{}}', false)
  activity.close('b')
  activity.close('control')
  assert.equal(changes, 1)
  activity.close('terminal')
  assert.equal(changes, 2)
  activity.close('missing')
  activity.clear()
  assert.equal(changes, 2)
  activity.open('exec', 'exec')
  assert.equal(changes, 3)
  activity.clear()
  assert.equal(changes, 4)
})
