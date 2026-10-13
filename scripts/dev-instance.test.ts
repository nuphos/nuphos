import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { acquireDevInstance, instanceRunning } from './dev-instance.ts'

test('one concurrent launcher per instance key; other keys remain independent', async (t) => {
  const key = `test-${randomUUID()}`
  const results = await Promise.allSettled([acquireDevInstance(key), acquireDevInstance(key)])
  const owner = results.find((result) => result.status === 'fulfilled')

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  assert.ok(owner?.status === 'fulfilled')
  t.after(owner.value)
  await assert.rejects(acquireDevInstance(key), /already running.*NUPHOS_DEV_INSTANCE/)
  assert.equal(await instanceRunning(key), true)
  t.after(await acquireDevInstance(`${key}-other`))
})

test('stopping a launcher releases its lease for the next invocation', async (t) => {
  const key = `test-${randomUUID()}`
  const release = await acquireDevInstance(key)

  release()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(await instanceRunning(key), false)
  const next = await acquireDevInstance(key)

  assert.equal(typeof next, 'function')
  t.after(next)
})

test('rm deletes only the named instance, never one whose name extends it', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'nuphos-instances-'))

  t.after(() => rm(home, { recursive: true, force: true }))
  process.env.HOME = home
  const { readInstances, removeInstance, writeInstance } = await import(
    `./dev-instance.ts?home=${home}`
  )
  const make = async (key: string) => {
    const dir = join(home, key)
    const record = {
      key,
      root: home,
      pid: null,
      backend: null,
      vite: null,
      cdp: null,
      appData: join(dir, 'profile'),
      cliConfig: join(dir, 'cli.yaml'),
      logDir: join(dir, 'logs'),
      groups: [],
    }

    await mkdir(record.logDir, { recursive: true })
    await mkdir(record.appData)
    await writeFile(join(record.logDir, `${key}-1-backend.log`), '')
    await writeFile(record.cliConfig, '')
    writeInstance(record)

    return record
  }
  const gone = await make('pr237')
  const kept = await make('pr237-e2e')

  await removeInstance('pr237', () => {})
  assert.deepEqual(
    readInstances().map((r: { key: string }) => r.key),
    ['pr237-e2e'],
  )
  assert.equal(existsSync(gone.logDir) || existsSync(gone.appData), false)
  assert.equal(existsSync(kept.logDir) && existsSync(kept.appData), true)
  assert.equal(existsSync(kept.cliConfig), true)
})
