import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LocalDownloadStream } from './download-stream.ts'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

/** Serves `body` once, saves it with `stream`, and returns what the host answered. */
async function save(stream: LocalDownloadStream, body: string, path: string) {
  const server = createServer((_request, response) => response.end(body))

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const messages: unknown[] = []

  try {
    stream.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))))
    await tick()
    stream.send(
      JSON.stringify({ url: `http://127.0.0.1:${String(port)}/`, size: body.length, path }),
    )
    while (stream.readyState !== 3) await tick()
  } finally {
    server.close()
  }

  return messages
}

// exFAT drives and some network shares have no hard links (#3192).
for (const code of ['EPERM', 'ENOTSUP', 'EXDEV']) {
  test(`a folder without hard links (${code}) still gets the file, and never a replaced one`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'download-stream-'))
    const noLinks = () => Promise.reject(Object.assign(new Error('no hard links'), { code }))

    try {
      const path = join(dir, 'deck.html')

      assert.deepEqual(await save(new LocalDownloadStream(noLinks), 'deck', path), [
        { t: 'done', path },
      ])
      assert.equal(await readFile(path, 'utf8'), 'deck')
      assert.deepEqual(await readdir(dir), ['deck.html'])
      // A file that appears between the check and the copy is kept.
      const raced = join(dir, 'raced.html')
      const appears = async () => {
        await writeFile(raced, 'theirs')

        return noLinks()
      }

      assert.deepEqual(await save(new LocalDownloadStream(appears), 'ours', raced), [
        { t: 'error', error: 'file_exists' },
      ])
      assert.equal(await readFile(raced, 'utf8'), 'theirs')
      assert.deepEqual((await readdir(dir)).sort(), ['deck.html', 'raced.html'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
