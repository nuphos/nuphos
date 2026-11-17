import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LocalUploadStream } from './upload-stream.ts'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

test('file errors are bounded and never forward raw uploader errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'upload-stream-'))
  const path = join(dir, 'fixture.bin')

  try {
    await writeFile(path, 'fixture')
    for (const [input, error] of [
      ['relative.bin', 'absolute_path_required'],
      [dir, 'not_a_file'],
      [join(dir, 'missing'), 'file_not_found'],
      [path, 'upload_failed'],
    ]) {
      let uploads = 0
      const stream = new LocalUploadStream(async () => {
        uploads++
        throw new Error('https://fixture.invalid/?signed=NEVER_RETURN_THIS')
      })
      const messages: unknown[] = []

      stream.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))))
      await tick()
      stream.send(JSON.stringify({ path: input }))
      stream.send(JSON.stringify({ path: input }))
      while (stream.readyState !== 3) await tick()
      assert.deepEqual(messages, [{ t: 'error', error }])
      assert.equal(uploads, input === path ? 1 : 0)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('closing a stream aborts an upload and suppresses late results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'upload-cancel-'))
  const path = join(dir, 'fixture.bin')
  let signal: AbortSignal | undefined
  let started: () => void = () => {}
  const uploading = new Promise<void>((resolve) => {
    started = resolve
  })
  let complete: (value: never) => void = () => {}
  const stream = new LocalUploadStream((_team, _session, _entries, _post, _label, uploadSignal) => {
    signal = uploadSignal
    started()

    return new Promise((resolve) => {
      complete = resolve
    })
  })
  const messages: unknown[] = []

  try {
    await writeFile(path, 'fixture')
    stream.addEventListener('message', (event) => messages.push(event.data))
    await tick()
    stream.send(JSON.stringify({ path }))
    await uploading
    stream.close()
    assert.ok(signal)
    assert.equal(signal.aborted, true)
    complete({} as never)
    await tick()
    assert.deepEqual(messages, [])
  } finally {
    stream.close()
    await rm(dir, { recursive: true, force: true })
  }
})
