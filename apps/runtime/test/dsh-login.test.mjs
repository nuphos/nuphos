import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { runDshLogin, signInPatch } from '../image/dsh-login.mjs'

function lines(...answers) {
  return answers[Symbol.iterator]()
}

/** A stand-in for DSH under the sign-in overlay, replaying `frames` (or their promises) in order. */
function fakeDsh(frames) {
  const seen = { written: [], stopped: false }
  const start = async ({ method }) => {
    seen.method = method
    const queue = [...frames]
    return {
      port: 41234,
      frames: {
        next: async () => {
          const frame = queue.shift()
          return typeof frame === 'function' ? frame() : (frame ?? new Promise(() => {}))
        },
      },
      write: (text) => seen.written.push(text),
      stop: () => (seen.stopped = true),
    }
  }
  return { seen, start }
}

async function withHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'nuphos-dsh-login-'))
  try {
    await run(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

const profilePatch = (home) => readFile(join(home, 'profiles', 'acp', 'cordis.patch.yml'), 'utf8')

test('an API key goes to DSH on stdin and keeps the shipped API-key route', async () => {
  await withHome(async (dshHome) => {
    const frames = []
    const dsh = fakeDsh([{ type: 'done', phase: 'succeeded' }])
    await runDshLogin({
      lines: lines('api-key', 'sk-test'),
      emit: (frame) => frames.push(frame),
      start: dsh.start,
      dshHome,
    })
    assert.deepEqual(
      frames.map((frame) => frame.type),
      ['choose', 'input', 'authenticated'],
    )
    assert.equal(frames[1].secret, true)
    assert.equal(dsh.seen.method, 'api-key')
    assert.deepEqual(dsh.seen.written, ['sk-test'])
    assert.ok(dsh.seen.stopped)
    assert.equal(await profilePatch(dshHome), '[]\n')
  })
})

test('an account signs in through the pasted loopback address and selects its route', async () => {
  await withHome(async (dshHome) => {
    const frames = []
    const fetched = []
    let finish
    const done = new Promise((resolve) => (finish = resolve))
    const dsh = fakeDsh([
      { type: 'browser', url: 'https://platform.deepseek.com/dsh/authorize?x=1' },
      () => done,
    ])
    await runDshLogin({
      lines: lines('account', 'http://127.0.0.1:41234/oauth/callback?code=c&state=s'),
      emit: (frame) => frames.push(frame),
      start: dsh.start,
      fetchImpl: async (url) => {
        fetched.push(String(url))
        finish({ type: 'done', phase: 'succeeded' })
      },
      dshHome,
    })
    assert.deepEqual(frames[1], {
      type: 'browser',
      url: 'https://platform.deepseek.com/dsh/authorize?x=1',
      paste: 'address',
    })
    assert.deepEqual(fetched, ['http://127.0.0.1:41234/oauth/callback?code=c&state=s'])
    assert.equal(frames.at(-1).type, 'authenticated')
    assert.match(await profilePatch(dshHome), /provider: deepseek-account/)
  })
})

test('an address for another listener is refused and DSH is stopped', async () => {
  const dsh = fakeDsh([{ type: 'browser', url: 'https://platform.deepseek.com/dsh/authorize' }])
  await assert.rejects(
    runDshLogin({
      lines: lines('account', 'http://127.0.0.1:9/oauth/callback?code=c&state=s'),
      emit: () => {},
      start: dsh.start,
      fetchImpl: async () => assert.fail('fetched'),
      dshHome: '/nonexistent',
    }),
    /Not the sign-in address/,
  )
  assert.ok(dsh.seen.stopped)
})

test('an attempt DSH ends first fails the sign-in', async () => {
  const dsh = fakeDsh([{ type: 'done', phase: 'expired' }])
  await assert.rejects(
    runDshLogin({
      lines: lines('api-key', 'sk-test'),
      emit: () => {},
      start: dsh.start,
      dshHome: '/nonexistent',
    }),
    /did not sign in/,
  )
})

test('the overlay switches ACP off and mounts the web server only for an account', () => {
  const account = signInPatch({ plugin: '/opt/nuphos-runtime/dsh-sign-in.mjs', port: 4100 })
  assert.match(account, /- id: acp\n {2}disabled: true/)
  assert.match(account, /@deepseek-ai\/dsh-host-webserver/)
  assert.match(account, /port: 4100/)
  assert.match(account, /name: "\/opt\/nuphos-runtime\/dsh-sign-in.mjs"/)
  assert.doesNotMatch(signInPatch({ plugin: '/p.mjs' }), /webserver/)
})
