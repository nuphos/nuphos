import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  NO_PULL,
  composeImages,
  errorTail,
  pullLabel,
  pullLine,
  singleFlight,
} from './dev-stack-state.ts'

test('pull progress counts layers from docker pull plain output', () => {
  const progress = [
    '0.0.13-claude-code: Pulling from zeabur/nuphos-runtime',
    'aaaaaaaaaaaa: Already exists',
    'bbbbbbbbbbbb: Pulling fs layer',
    'cccccccccccc: Pulling fs layer',
    'bbbbbbbbbbbb: Download complete',
    'bbbbbbbbbbbb: Pull complete',
    'cccccccccccc: Waiting',
  ].reduce(pullLine, NO_PULL)

  assert.equal(pullLabel(progress), 'pulling image, 2/3 layers')
  assert.equal(pullLabel(NO_PULL), 'pulling image …')
})

test('a finished layer stays finished', () => {
  const progress = ['dddddddddddd: Pull complete', 'dddddddddddd: Verifying Checksum'].reduce(
    pullLine,
    NO_PULL,
  )

  assert.equal(pullLabel(progress), 'pulling image, 1/1 layers')
})

test('compose config yields each service image and platform', () => {
  const json = JSON.stringify({
    services: {
      mongo: { image: 'mongo:8.0.32' },
      runtime: {
        image: 'ghcr.io/zeabur/nuphos-runtime:0.0.13-claude-code',
        platform: 'linux/amd64',
      },
      backend: { build: {} },
    },
  })

  assert.deepEqual(composeImages(json), {
    mongo: { image: 'mongo:8.0.32' },
    runtime: { image: 'ghcr.io/zeabur/nuphos-runtime:0.0.13-claude-code', platform: 'linux/amd64' },
  })
})

test('the error tail keeps the last non-empty lines', () => {
  assert.equal(
    errorTail(['pulling', '', 'Error response from daemon: denied', '  ']),
    'pulling · Error response from daemon: denied',
  )
})

test('single-flight shares one run between overlapping callers, then allows a new one', async () => {
  let runs = 0
  let release = () => {}
  const up = singleFlight(
    () =>
      new Promise<number>((resolve) => {
        runs++
        release = () => resolve(runs)
      }),
  )
  const first = up()
  const second = up()

  release()
  assert.deepEqual(await Promise.all([first, second]), [1, 1])
  const third = up()

  release()
  assert.equal(await third, 2)
})
