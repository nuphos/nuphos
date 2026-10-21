// Puts a turn's attachments on the runtime's disk and prints their paths. A fixed
// program: only signed download references travel on job stdin, and image bytes never
// pass through ACP or a shell command. Desktop bundles this file for its local runtime.
import { mkdir, mkdtemp, readFile, readdir, lstat, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { text } from 'node:stream/consumers'
// As a panel runner, argv[2] is the run directory holding params.json. As a Desktop
// local runtime's own `attachments` job, the file list arrives on stdin.
const localRoot = process.argv[2] === '--local-root' ? process.argv[3] : undefined
const { files } = JSON.parse(
  process.argv[2] && !localRoot
    ? await readFile(join(process.argv[2], 'params.json'), 'utf8')
    : await text(process.stdin),
)
// Not tmpdir(): a runtime job's TMPDIR is removed when the job exits, before the agent reads it.
const root = localRoot ?? '/tmp'
await mkdir(root, { recursive: true, mode: 0o700 })
// Reclaim expired local batches on each request; never sweep a shared cloud /tmp.
if (localRoot) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('nuphos-attachments-')) continue
    const path = join(root, entry.name)
    const info = await lstat(path).catch(() => undefined)
    if (info?.isDirectory() && info.mtimeMs < cutoff)
      await rm(path, { recursive: true, force: true }).catch(() => {})
  }
}
const dir = await mkdtemp(join(root, 'nuphos-attachments-'))
const paths = []
try {
  for (const [index, file] of files.entries()) {
    const folder = join(dir, String(index))
    await mkdir(folder, { mode: 0o700 })
    const name = file.name
      .split(/[\\/]/)
      .pop()
      .replace(/[\x00-\x1f\x7f]/g, '_')
    const path = join(folder, !name || name === '.' || name === '..' ? 'attachment' : name)
    const response = await fetch(file.url, {
      signal: AbortSignal.timeout(60000),
      redirect: 'error',
    })
    if (!response.ok || !response.body) throw new Error('Download failed')
    let size = 0
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, done) {
          size += chunk.length
          done(size > file.size ? new Error('Attachment exceeded declared size') : null, chunk)
        },
      }),
      createWriteStream(path, { mode: 0o600, flags: 'wx' }),
    )
    if (size !== file.size) throw new Error('Incomplete attachment')
    paths.push(path)
  }
  process.stdout.write(JSON.stringify({ paths }))
} catch {
  await rm(dir, { recursive: true, force: true })
  process.stdout.write(JSON.stringify({ error: 'Could not prepare attachments on the runtime' }))
  process.exitCode = 1
}
