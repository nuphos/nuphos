import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { nuphosSessionHomeEnv, nuphosSweepSessionHomes } from '../image/session-home.mjs'

const DAY = 24 * 60 * 60 * 1000
const sha = (value) => createHash('sha256').update(value).digest('hex')
const sweepable = process.platform === 'linux' || process.platform === 'darwin'

function runtime(t) {
  const dir = mkdtempSync(join(tmpdir(), 'nuphos-home-sweep-'))
  t.after(() => {
    chmodTree(dir)
    rmSync(dir, { recursive: true, force: true })
  })
  // Reached through a symlink, as macOS's /var is, so working directories
  // (reported resolved) and HOME (as given) spell the root differently.
  mkdirSync(join(dir, 'real'))
  symlinkSync(join(dir, 'real'), join(dir, 'home'))
  const HOME = join(dir, 'home')
  return { HOME, PATH: process.env.PATH, root: join(HOME, '.nuphos', 'session-homes') }
}

function chmodTree(dir) {
  if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) return
  chmodSync(dir, 0o700)
  for (const entry of readdirSync(dir, { withFileTypes: true }))
    if (entry.isDirectory()) chmodTree(join(dir, entry.name))
}

function put(file, text = 'fixture') {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

// Every entry of the tree last changed `days` ago, symlinks included.
function age(path, days) {
  const at = new Date(Date.now() - days * DAY)
  const stat = lstatSync(path)
  if (stat.isDirectory() && !stat.isSymbolicLink())
    for (const name of readdirSync(path)) age(join(path, name), days)
  lutimesSync(path, at, at)
}

function home(host, id, ...files) {
  const { HOME } = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: id }, host)
  for (const file of files) put(join(HOME, file))
  return HOME
}

function live(t, options) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    ...options,
  })
  t.after(() => child.kill('SIGKILL'))
  return new Promise((resolve) => child.once('spawn', resolve))
}

// First: a process sweeps at most once an hour, and this is the first home it opens.
test('opening a session starts a low-priority sweep that removes week-idle homes', async (t) => {
  if (!sweepable) return t.skip('Homes are only swept on Linux and macOS')
  const host = runtime(t)
  const stale = join(host.root, sha('stale'))
  put(join(stale, '.aws', 'config'))
  age(stale, 8)
  const current = home(host, 'current')
  for (let wait = 0; existsSync(stale) && wait < 100; wait++)
    await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(existsSync(stale), false)
  assert.equal(existsSync(current), true)
  assert.equal(existsSync(join(host.root, '.sweep')), true)
})

test('only idle, unused, real session homes directly under the root are removed', async (t) => {
  if (!sweepable) return t.skip('Homes are only swept on Linux and macOS')
  const host = runtime(t)
  const outside = join(host.HOME, '..', 'outside')
  put(join(outside, 'keep.txt'))
  const idle = home(host, 'idle', '.kube/config', 'go/pkg/mod/readonly/file.go')
  chmodSync(join(idle, 'go', 'pkg', 'mod', 'readonly'), 0o500)
  symlinkSync(outside, join(idle, 'link-to-outside'))
  const teammate = `${idle}.${sha('actor')}`
  put(join(teammate, '.gitconfig'))
  const recent = home(host, 'recent', '.gitconfig')
  const byHome = home(host, 'by-home')
  const byCwd = home(host, 'by-cwd', 'src/app/index.js')
  const changedInside = home(host, 'changed-inside', 'old.txt', 'new.txt')
  const leftover = join(host.root, `${sha('gone')}.reclaim-1700000000000-${sha('x').slice(0, 8)}`)
  put(join(leftover, 'file'))
  const unrelated = join(host.root, 'notes')
  put(join(unrelated, 'file'))
  const linked = join(host.root, sha('linked'))
  symlinkSync(outside, linked)
  for (const dir of [idle, teammate, byHome, byCwd, changedInside, leftover, unrelated, outside])
    age(dir, 8)
  lutimesSync(linked, new Date(Date.now() - 8 * DAY), new Date(Date.now() - 8 * DAY))
  age(join(recent, '.gitconfig'), 8) // The home itself was just opened.
  put(join(changedInside, 'new.txt'), 'edited today')
  await live(t, { env: { ...process.env, HOME: byHome } })
  await live(t, { cwd: join(byCwd, 'src', 'app') })

  const removed = await nuphosSweepSessionHomes(host.root, { pauseMs: 0 })

  assert.deepEqual(
    removed.sort(),
    [idle, teammate, leftover].map((dir) => dir.slice(host.root.length + 1)).sort(),
  )
  for (const dir of [idle, teammate, leftover]) assert.equal(existsSync(dir), false)
  for (const dir of [recent, byHome, byCwd, changedInside, unrelated])
    assert.equal(existsSync(dir), true, dir)
  assert.equal(lstatSync(linked).isSymbolicLink(), true)
  assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'fixture')
  assert.deepEqual(
    readdirSync(host.root).filter((name) => name.includes('.reclaim-')),
    [],
    'nothing is left set aside',
  )
})

test('a conversation woken after its home was swept gets a clean one that is kept', async (t) => {
  if (!sweepable) return t.skip('Homes are only swept on Linux and macOS')
  const host = runtime(t)
  const before = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'woken' }, host)
  put(before.KUBECONFIG, 'old login')
  age(before.HOME, 8)
  assert.deepEqual(await nuphosSweepSessionHomes(host.root, { pauseMs: 0 }), [sha('woken')])
  assert.equal(existsSync(before.HOME), false)

  const after = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'woken' }, host)
  assert.deepEqual(after, before)
  assert.equal(statSync(after.HOME).mode & 0o777, 0o700)
  assert.throws(() => readFileSync(after.KUBECONFIG), { code: 'ENOENT' })
  put(after.KUBECONFIG, 'new login')
  assert.equal(readFileSync(after.KUBECONFIG, 'utf8'), 'new login')
  assert.deepEqual(await nuphosSweepSessionHomes(host.root, { pauseMs: 0 }), [])
})

test('reopening an idle home renews it, so a resumed conversation keeps its logins', async (t) => {
  if (!sweepable) return t.skip('Homes are only swept on Linux and macOS')
  const host = runtime(t)
  const { HOME, KUBECONFIG } = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'resumed' }, host)
  put(KUBECONFIG, 'login')
  age(HOME, 8)
  nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'resumed' }, host)
  assert.deepEqual(await nuphosSweepSessionHomes(host.root, { pauseMs: 0 }), [])
  assert.equal(readFileSync(KUBECONFIG, 'utf8'), 'login')
})

test('a home holding a mount is kept whole, mounted data included', async (t) => {
  const probe = spawnSync('unshare', ['-rm', 'true'])
  if (process.platform !== 'linux' || probe.status !== 0)
    return t.skip('Needs an unprivileged mount namespace (unshare -rm)')
  const host = runtime(t)
  const idle = home(host, 'mounted', '.kube/config')
  mkdirSync(join(idle, 'share'))
  // In its own mount namespace, so the tmpfs disappears with the process.
  const script = `
    import { lutimesSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
    import { execFileSync } from 'node:child_process'
    import { nuphosSweepSessionHomes } from ${JSON.stringify(new URL('../image/session-home.mjs', import.meta.url).href)}
    const [idle, root] = process.argv.slice(1)
    execFileSync('mount', ['-t', 'tmpfs', 'tmpfs', idle + '/share'])
    writeFileSync(idle + '/share/data', 'outside the home')
    const old = new Date(Date.now() - 8 * 86400000)
    for (const at of ['/share/data', '/share', '/.kube/config', '/.kube', ''])
      lutimesSync(idle + at, old, old)
    const removed = await nuphosSweepSessionHomes(root, { pauseMs: 0 })
    console.log(JSON.stringify({ removed, data: existsSync(idle + '/share/data'),
      config: existsSync(idle + '/.kube/config'), names: readdirSync(root) }))
  `
  const run = spawnSync(
    'unshare',
    ['-rm', process.execPath, '--input-type=module', '-e', script, idle, host.root],
    { encoding: 'utf8' },
  )
  assert.equal(run.status, 0, run.stderr)
  const result = JSON.parse(run.stdout)
  assert.deepEqual(result.removed, [])
  assert.equal(result.data, true)
  assert.equal(result.config, true, 'nothing in the home is removed')
  assert.equal(result.names.includes(sha('mounted')), true)
})
