import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const syncScript = fileURLToPath(new URL('../image/sync-skills.sh', import.meta.url))

const encode = (value) => Buffer.from(value).toString('base64')

async function serveBundles(handler) {
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(handler(request)))
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${server.address().port}/skills`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function sync(env) {
  const child = spawn('bash', [syncScript], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''

  child.stdout.resume()
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  return new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

// The runtime image is Debian; BSD mv has no -T, so the atomic symlink swap
// needs GNU coreutils when the test runs on a developer's macOS machine.
const gnuBin = [
  '/opt/homebrew/opt/coreutils/libexec/gnubin',
  '/usr/local/opt/coreutils/libexec/gnubin',
].find((dir) => existsSync(join(dir, 'mv')))

const workspaceEnv = (url) => ({
  ...process.env,
  PATH: gnuBin ? `${gnuBin}:${process.env.PATH}` : process.env.PATH,
  NUPHOS_RUNTIME_WORKSPACE: mkdtempSync(join(tmpdir(), 'nuphos-runtime-skills-')),
  NUPHOS_RUNTIME_SKILLS_URL: url,
  NUPHOS_RUNTIME_SKILLS_TOKEN: 'narrow-token',
})

test('installs the authenticated bundle with executable scripts', async () => {
  const observed = { authorization: null }
  const server = await serveBundles((request) => {
    observed.authorization = request.headers.authorization ?? null

    return {
      revision: 'rev-1',
      files: [
        { path: 'nuphos-plan/SKILL.md', contentBase64: encode('# Plan'), executable: false },
        {
          path: 'nuphos-plan/scripts/create.sh',
          contentBase64: encode('#!/bin/sh\n'),
          executable: true,
        },
        {
          path: 'architecture-diagram/SKILL.md',
          contentBase64: encode('# Architecture'),
          executable: false,
        },
        {
          path: 'cost-management/SKILL.md',
          contentBase64: encode('# Cost Management'),
          executable: false,
        },
      ],
    }
  })

  try {
    const env = workspaceEnv(server.url)
    const skills = join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude/skills')
    const { code, stderr } = await sync(env)

    assert.equal(code, 0)
    assert.equal(stderr, '')
    assert.equal(observed.authorization, 'Bearer narrow-token')
    assert.equal(readFileSync(join(skills, 'nuphos-plan/SKILL.md'), 'utf8'), '# Plan')
    assert.notEqual(statSync(join(skills, 'nuphos-plan/scripts/create.sh')).mode & 0o111, 0)
    assert.equal(
      readFileSync(join(skills, 'architecture-diagram/SKILL.md'), 'utf8'),
      '# Architecture',
    )
    assert.equal(
      readFileSync(join(skills, 'cost-management/SKILL.md'), 'utf8'),
      '# Cost Management',
    )
  } finally {
    await server.close()
  }
})

test('rejects a bundle that points outside the skills tree', async () => {
  const server = await serveBundles(() => ({
    revision: 'rev-1',
    files: [{ path: '../escaped/SKILL.md', contentBase64: encode('# Escaped'), executable: false }],
  }))

  try {
    const env = workspaceEnv(server.url)
    const { code, stderr } = await sync(env)

    assert.notEqual(code, 0)
    assert.ok(stderr.includes('unsafe runtime skill path: ../escaped/SKILL.md'))
    assert.equal(existsSync(join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude/skills')), false)
    assert.equal(existsSync(join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude/escaped')), false)
  } finally {
    await server.close()
  }
})

test('leaves the live tree untouched when the bundle has not changed', async () => {
  const server = await serveBundles(() => ({
    revision: 'rev-1',
    files: [{ path: 'kept/SKILL.md', contentBase64: encode('# One'), executable: false }],
  }))

  try {
    const env = workspaceEnv(server.url)
    const claude = join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude')
    const skills = join(claude, 'skills')
    const run = async () => {
      const { code, stderr } = await sync(env)

      assert.equal(stderr, '')
      assert.equal(code, 0)
    }

    await run()
    const installed = readlinkSync(skills)
    const before = statSync(join(skills, 'kept/SKILL.md')).ino

    await run()
    await run()

    assert.equal(readlinkSync(skills), installed)
    assert.equal(statSync(join(skills, 'kept/SKILL.md')).ino, before)
    assert.equal(readFileSync(join(skills, 'kept/SKILL.md'), 'utf8'), '# One')
    assert.deepEqual(
      readdirSync(claude).filter((entry) => entry.startsWith('skills.')),
      [installed],
    )
  } finally {
    await server.close()
  }
})

test('an unchanged bundle is settled by a conditional request, not a whole body', async () => {
  const seen = []
  const bundle = {
    revision: 'rev-1',
    files: [{ path: 'kept/SKILL.md', contentBase64: encode('# One'), executable: false }],
  }
  // A backend that understands the entity tag answers 304 with no body at all.
  // The script has to treat that as success and stop before parsing — `jq` on an
  // empty file would fail it, and provisioned pods run this same script.
  const server = createServer((request, response) => {
    request.resume()
    seen.push(request.headers['if-none-match'])
    if (request.headers['if-none-match'] === `"${bundle.revision}"`) {
      response.writeHead(304)
      response.end()

      return
    }
    response.writeHead(200, { 'content-type': 'application/json', etag: `"${bundle.revision}"` })
    response.end(JSON.stringify(bundle))
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const env = workspaceEnv(`http://127.0.0.1:${server.address().port}/skills`)
    const claude = join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude')

    // Nothing installed yet, so there is no tag to offer and the body must arrive.
    assert.deepEqual(await sync(env), { code: 0, stderr: '' })
    assert.deepEqual(seen, [undefined])
    const installed = readlinkSync(join(claude, 'skills'))

    assert.deepEqual(await sync(env), { code: 0, stderr: '' })
    assert.deepEqual(seen, [undefined, '"rev-1"'])
    // The 304 left the live tree exactly as it was.
    assert.equal(readlinkSync(join(claude, 'skills')), installed)
    assert.equal(readFileSync(join(claude, 'skills/kept/SKILL.md'), 'utf8'), '# One')
    assert.equal(readFileSync(join(claude, '.skills-revision'), 'utf8'), 'rev-1')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('a backend that ignores the entity tag still installs the bundle', async () => {
  // The image ships ahead of the backend that answers 304, so an older backend
  // returning a full 200 to a conditional request must still work.
  const server = await serveBundles(() => ({
    revision: 'rev-2',
    files: [{ path: 'kept/SKILL.md', contentBase64: encode('# Two'), executable: false }],
  }))

  try {
    const env = workspaceEnv(server.url)
    const claude = join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude')

    assert.deepEqual(await sync(env), { code: 0, stderr: '' })
    assert.deepEqual(await sync(env), { code: 0, stderr: '' })
    assert.equal(readFileSync(join(claude, 'skills/kept/SKILL.md'), 'utf8'), '# Two')
    assert.equal(readFileSync(join(claude, '.skills-revision'), 'utf8'), 'rev-2')
  } finally {
    await server.close()
  }
})

test('staging trees abandoned by a killed run are swept, and a live one is not', async () => {
  // A caller's timeout SIGKILLs the process group, which skips the EXIT trap, so a
  // run that died mid-fetch leaves its `.skills-sync.*` tree behind. Without a sweep
  // a self-hosted runtime behind a slow backend would accumulate them forever.
  const server = await serveBundles(() => ({ revision: 'rev-1', files: [] }))

  try {
    const env = workspaceEnv(server.url)
    const claude = join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude')
    const abandoned = join(claude, '.skills-sync.dead01')
    const inFlight = join(claude, '.skills-sync.live01')

    mkdirSync(join(abandoned, 'skills'), { recursive: true })
    writeFileSync(join(abandoned, 'bundle.json'), 'partial')
    mkdirSync(inFlight, { recursive: true })
    // Older than any run could live — curl alone gives up after two minutes.
    const hourAgo = new Date(Date.now() - 60 * 60_000)

    utimesSync(abandoned, hourAgo, hourAgo)

    assert.deepEqual(await sync(env), { code: 0, stderr: '' })
    assert.equal(existsSync(abandoned), false)
    // A sync still fetching sits outside the lock with a fresh directory; sweeping it
    // would pull the staging tree out from under a run that is about to install.
    assert.equal(existsSync(inFlight), true)
  } finally {
    await server.close()
  }
})

const flockBinary = ['/usr/bin/flock', '/opt/homebrew/bin/flock'].find((path) => existsSync(path))

/** Hold the sync lock from outside, the way a run in its critical section would. */
function holdSyncLock(claude, seconds) {
  const holder = spawn(flockBinary, [join(claude, '.skills-sync.lock'), 'sleep', String(seconds)], {
    stdio: 'ignore',
  })

  return {
    release: () => holder.kill('SIGKILL'),
    exited: new Promise((r) => holder.once('exit', r)),
  }
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const started = Date.now()

  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition never became true')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

test('a run waiting on the lock keeps its staging tree however long it waits', async (t) => {
  if (!flockBinary) {
    t.skip('flock is unavailable; the image ships util-linux and CI runs Linux')

    return
  }
  // The scenario that age-based sweeping got wrong: a run fetches, creates its staging
  // tree, then waits on the sync lock. The provisioner calls this with no parent
  // timeout, so that wait has no bound an age could exceed. A second run arriving
  // meanwhile must not mistake the waiter's tree for an abandoned one.
  const server = await serveBundles(() => ({
    revision: 'rev-wait',
    files: [{ path: 'kept/SKILL.md', contentBase64: encode('# Waited'), executable: false }],
  }))

  try {
    const env = workspaceEnv(server.url)
    const claude = join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude')

    mkdirSync(claude, { recursive: true })
    const lock = holdSyncLock(claude, 60)
    const staging = () =>
      readdirSync(claude).filter(
        (entry) => entry.startsWith('.skills-sync.') && entry !== '.skills-sync.lock',
      )

    const waiter = sync(env)

    await waitFor(() => staging().length === 1)
    const waiterTree = join(claude, staging()[0])

    // Make it look as abandoned as any age heuristic could ask.
    const hourAgo = new Date(Date.now() - 60 * 60_000)

    utimesSync(waiterTree, hourAgo, hourAgo)

    // A second run sweeps on its way in. It then queues behind the same lock and gives
    // up quickly, which is fine; what matters is what its sweep did.
    const sweeper = await sync({ ...env, NUPHOS_SKILLS_LOCK_WAIT_SECONDS: '1' })

    assert.equal(sweeper.code, 1)
    assert.equal(existsSync(waiterTree), true, 'a live waiter lost its staging tree')

    lock.release()
    await lock.exited
    assert.deepEqual(await waiter, { code: 0, stderr: '' })
    assert.equal(readFileSync(join(claude, 'skills/kept/SKILL.md'), 'utf8'), '# Waited')
  } finally {
    await server.close()
  }
})

test('a run gives up rather than wait forever behind a wedged holder', async (t) => {
  if (!flockBinary) {
    t.skip('flock is unavailable; the image ships util-linux and CI runs Linux')

    return
  }
  const server = await serveBundles(() => ({ revision: 'rev-1', files: [] }))

  try {
    const env = workspaceEnv(server.url)
    const claude = join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude')

    mkdirSync(claude, { recursive: true })
    const lock = holdSyncLock(claude, 60)
    const started = Date.now()
    const { code, stderr } = await sync({ ...env, NUPHOS_SKILLS_LOCK_WAIT_SECONDS: '1' })

    assert.equal(code, 1)
    assert.match(stderr, /held the lock too long/u)
    assert.ok(Date.now() - started < 15_000)
    // A normal exit still runs the trap, so giving up leaves nothing behind.
    assert.deepEqual(
      readdirSync(claude).filter(
        (entry) => entry.startsWith('.skills-sync.') && entry !== '.skills-sync.lock',
      ),
      [],
    )
    lock.release()
    await lock.exited
  } finally {
    await server.close()
  }
})

test('a workspace with no skills yet installs an empty tree rather than failing', async () => {
  // `jq -e` exits 4 when its filter yields nothing, so an empty `files` array used to
  // fail the whole sync under `set -e` — on provisioned pods too, not just here.
  const server = await serveBundles(() => ({ revision: 'rev-empty', files: [] }))

  try {
    const env = workspaceEnv(server.url)
    const claude = join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude')

    assert.deepEqual(await sync(env), { code: 0, stderr: '' })
    assert.equal(lstatSync(join(claude, 'skills')).isSymbolicLink(), true)
    assert.deepEqual(readdirSync(join(claude, 'skills')), [])
    assert.equal(readFileSync(join(claude, '.skills-revision'), 'utf8'), 'rev-empty')
  } finally {
    await server.close()
  }
})

test('a value that could rewrite the curl config is refused outright', async () => {
  const server = await serveBundles(() => ({ revision: 'rev-1', files: [] }))

  try {
    const base = workspaceEnv(server.url)
    // The config file is line-oriented, so a newline in either value would append
    // directives of the caller's choosing. These arrive from session metadata now,
    // so the script must refuse rather than try to quote around them.
    const stolen = join(base.NUPHOS_RUNTIME_WORKSPACE, 'stolen')
    const injections = [
      { NUPHOS_RUNTIME_SKILLS_URL: `${server.url}"\noutput = "${stolen}` },
      { NUPHOS_RUNTIME_SKILLS_TOKEN: `t"\noutput = "${stolen}` },
      { NUPHOS_RUNTIME_SKILLS_URL: `${server.url}\r\nupload-file = "/etc/passwd` },
      { NUPHOS_RUNTIME_SKILLS_TOKEN: 'back\\slash' },
      // Only http(s) may be fetched; `file://` would read the container's disk.
      { NUPHOS_RUNTIME_SKILLS_URL: 'file:///etc/passwd' },
    ]

    for (const override of injections) {
      const { code, stderr } = await sync({ ...base, ...override })

      assert.equal(code, 1, JSON.stringify(override))
      assert.match(stderr, /unusable character|must be http/u)
    }
    assert.equal(existsSync(stolen), false)
    // The unmodified pair still works, so the guard is not simply refusing everything.
    assert.deepEqual(await sync(base), { code: 0, stderr: '' })
  } finally {
    await server.close()
  }
})

test('concurrent syncs never leave the live tree dangling', async (t) => {
  // The lock is what makes this safe, and `flock` is how it is taken.
  if (!existsSync('/usr/bin/flock') && !existsSync('/opt/homebrew/bin/flock')) {
    t.skip('flock is unavailable; the image ships util-linux and CI runs Linux')

    return
  }
  let revision = 0
  const server = await serveBundles(() => ({
    // A distinct revision per request, so every caller believes it has new work and
    // reaches the install/swap/cleanup section that used to race.
    revision: `rev-${++revision}`,
    files: [{ path: 'kept/SKILL.md', contentBase64: encode('# One'), executable: false }],
  }))

  try {
    const env = workspaceEnv(server.url)
    const claude = join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude')
    const results = await Promise.all(Array.from({ length: 6 }, () => sync(env)))

    for (const result of results) assert.deepEqual(result, { code: 0, stderr: '' })
    // Whoever won last, the symlink must point at a tree that still exists: the
    // cleanup used to delete a tree another process had moved but not yet linked.
    const installed = readlinkSync(join(claude, 'skills'))

    assert.equal(existsSync(join(claude, installed)), true)
    assert.equal(readFileSync(join(claude, 'skills/kept/SKILL.md'), 'utf8'), '# One')
    assert.deepEqual(
      readdirSync(claude).filter((entry) => entry.startsWith('skills.')),
      [installed],
    )
    assert.equal(readFileSync(join(claude, '.skills-revision'), 'utf8'), installed.split('.')[1])
  } finally {
    await server.close()
  }
})

test('swaps a new bundle in without ever exposing a missing tree', async () => {
  const bundles = [
    {
      revision: 'rev-1',
      files: [
        {
          path: '_runtime/settings.json',
          contentBase64: encode('{"model":"old"}'),
          executable: false,
        },
        { path: 'kept/SKILL.md', contentBase64: encode('# One'), executable: false },
        { path: 'dropped/SKILL.md', contentBase64: encode('# Gone'), executable: false },
      ],
    },
    {
      revision: 'rev-2',
      files: [
        {
          path: '_runtime/settings.json',
          contentBase64: encode('{"model":"new"}'),
          executable: false,
        },
        { path: 'kept/SKILL.md', contentBase64: encode('# Two'), executable: false },
        { path: 'added/scripts/run.sh', contentBase64: encode('#!/bin/sh\n'), executable: true },
      ],
    },
  ]
  let served = 0
  const server = await serveBundles(() => bundles[Math.min(served++, bundles.length - 1)])

  try {
    const env = workspaceEnv(server.url)
    const claude = join(env.NUPHOS_RUNTIME_WORKSPACE, '.claude')
    const skills = join(claude, 'skills')
    const run = async () => {
      const { code, stderr } = await sync(env)

      assert.equal(stderr, '')
      assert.equal(code, 0)
    }

    await run()

    assert.equal(readFileSync(join(skills, 'kept/SKILL.md'), 'utf8'), '# One')
    assert.equal(readFileSync(join(claude, 'settings.json'), 'utf8'), '{"model":"old"}')
    assert.equal(readFileSync(join(claude, '.skills-revision'), 'utf8'), 'rev-1')

    await run()

    assert.equal(lstatSync(skills).isSymbolicLink(), true)
    assert.equal(readFileSync(join(skills, 'kept/SKILL.md'), 'utf8'), '# Two')
    assert.equal(readFileSync(join(skills, 'added/scripts/run.sh'), 'utf8'), '#!/bin/sh\n')
    assert.notEqual(statSync(join(skills, 'added/scripts/run.sh')).mode & 0o111, 0)
    assert.equal(existsSync(join(skills, 'dropped/SKILL.md')), false)
    assert.equal(readFileSync(join(claude, 'settings.json'), 'utf8'), '{"model":"new"}')
    assert.equal(readFileSync(join(claude, '.skills-revision'), 'utf8'), 'rev-2')
    assert.deepEqual(
      readdirSync(claude).filter((entry) => entry.startsWith('skills.')),
      [readlinkSync(skills)],
    )
    assert.ok(readlinkSync(skills).startsWith('skills.rev-2.'))
  } finally {
    await server.close()
  }
})
