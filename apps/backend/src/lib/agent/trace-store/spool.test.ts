import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

import { TraceSpool } from './spool'

test('failed delivery survives reopening the disk queue with the exact payload and stable id', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trace-spool-'))
  const path = join(directory, 'queue.sqlite')
  const row = {
    id: 'stable-id',
    sessionId: 'session',
    header: '{}',
    payload: '完整'.repeat(300_000),
  }
  const failed = new TraceSpool(
    path,
    () => Promise.reject(new Error('offline')),
    () => {},
  )

  try {
    failed.enqueue(row)
    await expect(failed.flush(1_000)).rejects.toThrow('offline')
    failed.close()
    const delivered: unknown[] = []
    const reopened = new TraceSpool(
      path,
      (event) => {
        delivered.push(event)

        return Promise.resolve()
      },
      () => {},
    )

    try {
      await reopened.flush(1_000)
      expect(delivered).toEqual([row])
      expect(statSync(path).mode & 0o777).toBe(0o600)
      await reopened.flush(1_000)
      expect(delivered).toHaveLength(1)
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a slow destination keeps one active delivery and preserves every queued event', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trace-spool-'))
  let release: (() => void) | undefined
  let active = 0
  let peak = 0
  const delivered: string[] = []
  const spool = new TraceSpool(
    join(directory, 'queue.sqlite'),
    async (event) => {
      active++
      peak = Math.max(peak, active)
      if (event.id === '0')
        await new Promise<void>((resolve) => {
          release = resolve
        })
      delivered.push(event.id)
      active--
    },
    () => {},
  )

  try {
    for (let i = 0; i < 20; i++)
      spool.enqueue({ id: String(i), sessionId: null, header: '{}', payload: 'x'.repeat(100_000) })
    await expect(spool.flush(5)).rejects.toThrow('timed out')
    expect(peak).toBe(1)
    release!()
    await spool.flush(2_000)
    expect(delivered).toEqual(Array.from({ length: 20 }, (_, i) => String(i)))
    expect(peak).toBe(1)
  } finally {
    spool.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
