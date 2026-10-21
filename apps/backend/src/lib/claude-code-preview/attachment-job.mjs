// Puts a turn's attachments on the runtime's disk and prints their paths. A fixed
// program: only signed download references travel on job stdin, and image bytes never
// pass through ACP or a shell command. Desktop bundles this file for its local runtime.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { text } from 'node:stream/consumers'
// As a panel runner, argv[2] is the run directory holding params.json. As a Desktop
// local runtime's own `attachments` job, the file list arrives on stdin.
const { files } = JSON.parse(
  process.argv[2]
    ? await readFile(join(process.argv[2], 'params.json'), 'utf8')
    : await text(process.stdin),
)
// Not tmpdir(): a runtime job's TMPDIR is removed when the job exits, before the agent reads it.
const dir = await mkdtemp('/tmp/nuphos-attachments-')
const paths = []
try {
  for (const [index, file] of files.entries()) {
    const folder = join(dir, String(index))
    await mkdir(folder, { mode: 0o700 })
    let name = file.name
      .split(/[\\/]/)
      .pop()
      .replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_')
      .replace(/[ .]+$/g, '')
    // Bound both UTF-8 bytes (POSIX) and UTF-16 code units (Windows).
    name = Array.from(name).slice(0, 180).join('')
    while (Buffer.byteLength(name, 'utf8') > 200) name = Array.from(name).slice(0, -1).join('')
    name = name.replace(/[ .]+$/g, '')
    if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)) name = `_${name}`
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
