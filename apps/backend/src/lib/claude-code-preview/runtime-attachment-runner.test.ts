import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { expect, test } from 'bun:test'

import { ATTACHMENT_RUNNER } from './runtime-attachment-runner'

async function run(files: unknown[], viaStdin = false) {
  const dir = await mkdtemp(join(tmpdir(), 'attachment-test-'))

  try {
    await writeFile(join(dir, 'runner.mjs'), ATTACHMENT_RUNNER)
    await writeFile(join(dir, 'params.json'), JSON.stringify({ files }))
    // Like an OpenAB runtime job: TMPDIR is the job directory, removed on exit.
    // As a Desktop `attachments` job the program takes the file list on stdin instead.
    const child = Bun.spawn(['node', join(dir, 'runner.mjs'), ...(viaStdin ? [] : [dir])], {
      env: { ...process.env, TMPDIR: dir },
      stdin: new TextEncoder().encode(viaStdin ? JSON.stringify({ files }) : ''),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect(stderr).toBe('')

    return { code, output: JSON.parse(stdout) as { paths?: string[]; error?: string } }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('bridge materializes images as private local files without filename collisions or traversal', async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (request) =>
      new Response(new URL(request.url).pathname === '/first' ? 'hello' : 'world'),
  })
  const { code, output } = await run([
    { name: '../../screen.png', url: new URL('/first', server.url).href, size: 5 },
    { name: 'screen.png', url: new URL('/second', server.url).href, size: 5 },
  ])
  const [first, second] = output.paths!

  try {
    expect(code).toBe(0)
    expect(first).not.toBe(second)
    expect(await readFile(first!, 'utf8')).toBe('hello')
    expect(await readFile(second!, 'utf8')).toBe('world')
    expect((await stat(first!)).mode & 0o777).toBe(0o600)
    expect(dirname(first!)).toEndWith('/0')
  } finally {
    await server.stop()
    await rm(dirname(dirname(first!)), { recursive: true, force: true })
  }
})

test('bridge downloads files itself and refuses incomplete or oversized bodies', async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response('report') })

  try {
    const good = await run([{ name: 'report.txt', url: server.url.toString(), size: 6 }])

    try {
      expect(good.code).toBe(0)
      expect(await readFile(good.output.paths![0]!, 'utf8')).toBe('report')
    } finally {
      await rm(dirname(dirname(good.output.paths![0]!)), { recursive: true, force: true })
    }
    for (const size of [3, 10]) {
      const bad = await run([{ name: 'report.txt', url: server.url.toString(), size }])

      expect(bad.code).toBe(1)
      expect(bad.output.paths).toBeUndefined()
      expect(bad.output.error).not.toContain(server.url.toString())
    }
  } finally {
    await server.stop()
  }
})

test('the bundled attachments job takes its file list on stdin', async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response('zip!') })

  try {
    const { code, output } = await run(
      [{ name: 'demo.zip', url: `http://127.0.0.1:${String(server.port)}/z`, size: 4 }],
      true,
    )

    expect(code).toBe(0)
    expect(await readFile(output.paths![0]!, 'utf8')).toBe('zip!')
    await rm(dirname(dirname(output.paths![0]!)), { recursive: true, force: true })
  } finally {
    await server.stop()
  }
})

test('downloaded filenames remain portable on Windows without changing file bytes', async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response('png') })
  const names = ['report?.png', 'CON.png', 'trailing. ', '圖'.repeat(300), `CON${' '.repeat(177)}x`]
  let paths: string[] = []

  try {
    const result = await run(names.map((name) => ({ name, url: server.url.href, size: 3 })))

    expect(result.code).toBe(0)
    paths = result.output.paths!
    expect(paths).toHaveLength(names.length)
    expect(basename(paths[0]!)).toBe('report_.png')
    expect(basename(paths[1]!)).toBe('_CON.png')
    expect(basename(paths[2]!)).toBe('trailing')
    expect(Buffer.byteLength(basename(paths[3]!), 'utf8')).toBeLessThanOrEqual(200)
    expect(basename(paths[4]!)).toBe('_CON')
    for (const path of paths) expect(await readFile(path, 'utf8')).toBe('png')
  } finally {
    await server.stop()
    if (paths[0]) await rm(dirname(dirname(paths[0])), { recursive: true, force: true })
  }
})
