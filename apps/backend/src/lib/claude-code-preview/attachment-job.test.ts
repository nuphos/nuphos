import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

const program = fileURLToPath(new URL('./attachment-job.mjs', import.meta.url))
const weekAndADayAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

test('a cloud run expires week-old secrets in the shared /tmp, never other attachments', async () => {
  const tag = crypto.randomUUID()
  const oldSecret = join('/tmp', `nuphos-secret-${tag}`)
  const oldAttachment = join('/tmp', `nuphos-attachments-${tag}`)
  const run = await mkdtemp(join('/tmp', 'attachment-job-run-'))
  const value = Buffer.from('sk-test-value')
  let written: string | undefined

  await mkdir(oldSecret)
  await mkdir(oldAttachment)
  await utimes(oldSecret, weekAndADayAgo, weekAndADayAgo)
  await utimes(oldAttachment, weekAndADayAgo, weekAndADayAgo)
  await writeFile(
    join(run, 'params.json'),
    JSON.stringify({
      secret: true,
      files: [
        {
          name: 'OPENAI_API_KEY',
          url: `data:application/octet-stream;base64,${value.toString('base64')}`,
          size: value.length,
        },
      ],
    }),
  )
  try {
    // As the runtime's panel job runs it: argv[2] is the run directory.
    const result = spawnSync(process.execPath, [program, run], { encoding: 'utf8' })
    const { paths } = JSON.parse(result.stdout) as { paths: string[] }

    written = paths[0]
    expect(written).toMatch(/^\/tmp\/nuphos-secret-[^/]+\/0\/OPENAI_API_KEY$/)
    expect((await stat(written!)).mode & 0o777).toBe(0o600)
    expect((await stat(dirname(dirname(written!)))).mode & 0o777).toBe(0o700)
    expect(await exists(oldSecret)).toBe(false)
    expect(await exists(oldAttachment)).toBe(true)
  } finally {
    await Promise.all(
      [oldSecret, oldAttachment, run, ...(written ? [dirname(dirname(written))] : [])].map((path) =>
        rm(path, { recursive: true, force: true }),
      ),
    )
  }
})
