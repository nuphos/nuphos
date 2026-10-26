import { spawn as nuphosSpawn } from 'node:child_process'
import { createHash as nuphosHomeHash } from 'node:crypto'
import {
  mkdirSync as nuphosMkdir,
  lstatSync as nuphosLstat,
  symlinkSync as nuphosSymlink,
  utimesSync as nuphosUtimes,
  writeFileSync as nuphosWriteFile,
} from 'node:fs'
import { homedir as nuphosHostHome, userInfo as nuphosAccount } from 'node:os'
import { join as nuphosJoin, delimiter as nuphosPathDelimiter } from 'node:path'

// Configuration isolation, not a filesystem security boundary: sessions still
// run as the same OS user. Never mutate process.env or copy ambient credentials.
// Use the conversation ID, not the ACP process/turn ID, so load/resume and token
// refresh keep the same home. Hash it so metadata cannot supply a filesystem path.
// A teammate's turns in someone else's conversation (NUPHOS_SESSION_ACTOR) get a
// home of their own, so neither side picks up the other's CLI logins.
export function nuphosSessionHomeEnv(sessionEnv = {}, runtimeEnv = process.env) {
  const id = sessionEnv.NUPHOS_SESSION_ID
  if (typeof id !== 'string' || !id.trim()) {
    if (sessionEnv.NUPHOS_TOKEN || sessionEnv.NUPHOS_TEAM_ID)
      throw new Error('Nuphos sessions require NUPHOS_SESSION_ID for CLI configuration isolation')
    return {} // Ordinary ACP clients without a Nuphos conversation keep their defaults.
  }
  const runtimeHome = runtimeEnv.HOME || runtimeEnv.USERPROFILE || nuphosHostHome()
  const root = nuphosJoin(runtimeHome, '.nuphos', 'session-homes')
  const hash = (value) => nuphosHomeHash('sha256').update(value).digest('hex')
  // <conversation> for the owner, <conversation>.<actor> for a teammate, so
  // reclaiming a conversation finds every home it left from its ID alone.
  const actor = sessionEnv.NUPHOS_SESSION_ACTOR
  const name = typeof actor === 'string' && actor ? `${hash(id)}.${hash(actor)}` : hash(id)
  const home = nuphosJoin(root, name)
  for (const dir of [root, home]) {
    nuphosMkdir(dir, { recursive: true, mode: 0o700 })
    if (!nuphosLstat(dir).isDirectory()) throw new Error('Session home must be a directory')
  }
  nuphosKeepSessionHome(root, home)
  // macOS finds the login Keychain through HOME, so without this a session has
  // none and every Keychain user (Chrome, for one) raises "Keychain Not Found".
  // OS credential stores stay shared. Link the account's own Keychains, which is
  // where they live whatever HOME the runtime itself was given.
  if (process.platform === 'darwin') {
    nuphosMkdir(nuphosJoin(home, 'Library'), { recursive: true, mode: 0o700 })
    try {
      nuphosSymlink(
        nuphosJoin(nuphosAccount().homedir, 'Library', 'Keychains'),
        nuphosJoin(home, 'Library', 'Keychains'),
      )
    } catch (error) {
      if (error.code !== 'EEXIST') throw error // Already linked, or a Keychain made here.
    }
  }
  const config = nuphosJoin(home, '.config')
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: nuphosJoin(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: nuphosJoin(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: nuphosJoin(home, '.cache'),
    // Only these content-addressed, concurrency-safe caches are shared, so each
    // conversation stops re-downloading and rebuilding the same artifacts. Other
    // tools keep login state under XDG_CACHE_HOME, so that stays per conversation.
    GOCACHE: nuphosJoin(runtimeHome, '.cache', 'go-build'),
    GOMODCACHE: nuphosJoin(runtimeHome, 'go', 'pkg', 'mod'),
    BUN_INSTALL_CACHE_DIR: nuphosJoin(runtimeHome, '.bun', 'install', 'cache'),
    PLAYWRIGHT_BROWSERS_PATH: nuphosJoin(runtimeHome, '.cache', 'ms-playwright', 'browsers'),
    PIP_CACHE_DIR: nuphosJoin(runtimeHome, '.cache', 'pip'),
    UV_CACHE_DIR: nuphosJoin(runtimeHome, '.cache', 'uv'),
    XDG_DATA_HOME: nuphosJoin(home, '.local', 'share'),
    XDG_STATE_HOME: nuphosJoin(home, '.local', 'state'),
    CLOUDSDK_CONFIG: nuphosJoin(config, 'gcloud'),
    GH_CONFIG_DIR: nuphosJoin(config, 'gh'),
    AWS_SHARED_CREDENTIALS_FILE: nuphosJoin(home, '.aws', 'credentials'),
    AWS_CONFIG_FILE: nuphosJoin(home, '.aws', 'config'),
    KUBECONFIG: nuphosJoin(home, '.kube', 'config'),
    AZURE_CONFIG_DIR: nuphosJoin(home, '.azure'),
    DOCKER_CONFIG: nuphosJoin(home, '.docker'),
    GIT_CONFIG_GLOBAL: nuphosJoin(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    NPM_CONFIG_USERCONFIG: nuphosJoin(home, '.npmrc'),
    GNUPGHOME: nuphosJoin(home, '.gnupg'),
    PATH: [nuphosJoin(home, '.local', 'bin'), runtimeEnv.PATH]
      .filter(Boolean)
      .join(nuphosPathDelimiter),
    NUPHOS_SESSION_HOME: home,
  }
}

// Claude's own login/session store belongs to the runtime. Pin its location
// before giving the SDK child (and its shell tools) the conversation's HOME.
export function nuphosClaudeSessionEnv(env, sessionEnv, runtimeEnv = process.env) {
  const isolated = nuphosSessionHomeEnv(sessionEnv, runtimeEnv)
  if (!isolated.HOME) return env
  return {
    ...env,
    CLAUDE_CONFIG_DIR:
      runtimeEnv.CLAUDE_CONFIG_DIR ||
      nuphosJoin(runtimeEnv.HOME || runtimeEnv.USERPROFILE || nuphosHostHome(), '.claude'),
    ...isolated,
  }
}

// Homes are never removed when a conversation ends, so a runtime sweeps the
// ones nobody has used for a week. It runs here because creating homes is what
// fills the disk, and every runtime (cloud image, Desktop, CLI host) creates
// them through this module. A woken conversation whose home was swept gets a
// fresh one from nuphosSessionHomeEnv, without its old CLI logins.
const NUPHOS_SWEEP_EVERY_MS = 60 * 60 * 1000
const nuphosLiveHomes = new Set()
let nuphosHomeHeartbeat
let nuphosSweepCheckedAt = 0

function nuphosTouchHome(home) {
  const now = new Date()
  try {
    nuphosUtimes(home, now, now)
  } catch {
    /* Gone or unwritable; the sweep keeps a home it cannot judge. */
  }
}

// The lease: while this process lives, the homes it handed out stay fresh.
function nuphosKeepSessionHome(root, home) {
  nuphosTouchHome(home)
  nuphosLiveHomes.add(home)
  nuphosHomeHeartbeat ??= setInterval(
    () => nuphosLiveHomes.forEach(nuphosTouchHome),
    NUPHOS_SWEEP_EVERY_MS,
  )
  nuphosHomeHeartbeat.unref?.()
  if (Date.now() - nuphosSweepCheckedAt < NUPHOS_SWEEP_EVERY_MS) return
  nuphosSweepCheckedAt = Date.now()
  // Without /proc, ps or lsof nothing can tell a home is in use, so Windows keeps them.
  if (process.platform !== 'linux' && process.platform !== 'darwin') return
  const stamp = nuphosJoin(root, '.sweep')
  try {
    if (Date.now() - nuphosLstat(stamp).mtimeMs < NUPHOS_SWEEP_EVERY_MS) return
  } catch {
    /* First sweep on this runtime. */
  }
  try {
    nuphosWriteFile(stamp, '')
  } catch {
    return
  }
  // Its own process at the lowest CPU and IO priority, so a shared machine does
  // not slow down. Only PATH (and Electron's run-as-Node switch) is passed on.
  const node = [process.execPath, '-e', `(${nuphosSweepSessionHomes})(process.argv[1])`, root]
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' }
  if (process.env.ELECTRON_RUN_AS_NODE) env.ELECTRON_RUN_AS_NODE = process.env.ELECTRON_RUN_AS_NODE
  const start = (argv, fallback) => {
    const child = nuphosSpawn(argv[0], argv.slice(1), { env, detached: true, stdio: 'ignore' })
    child.once('error', () => fallback && start(fallback))
    child.unref()
  }
  const low =
    process.platform === 'linux' ? ['ionice', '-c3', 'nice', '-n19'] : ['taskpolicy', '-b']
  start([...low, ...node], node)
}

// Self-contained (its source is run as the sweep process): removes the direct
// children of `root` named like a session home that no process uses and
// where nothing in the tree changed within `idleMs`.
export async function nuphosSweepSessionHomes(root, options = {}) {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const os = await import('node:os')
  const { execFile } = await import('node:child_process')
  const { randomUUID } = await import('node:crypto')
  const { now = Date.now(), idleMs = 7 * 24 * 60 * 60 * 1000, pauseMs = 20 } = options
  const cutoff = now - idleMs
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  try {
    os.setPriority(19)
  } catch {
    /* Already as low as allowed. */
  }
  const run = (command, args) =>
    new Promise((resolve) =>
      execFile(command, args, { maxBuffer: 64 << 20 }, (error, out) =>
        resolve(error && !out ? null : out),
      ),
    )
  // The HOME and working directory of every process of this user, as text;
  // null when they cannot be listed, which keeps every home.
  const processes = async () => {
    if (process.platform === 'linux') {
      const seen = []
      for (const pid of await fs.readdir('/proc')) {
        if (!/^\d+$/.test(pid)) continue
        const env = await fs.readFile(`/proc/${pid}/environ`, 'utf8').catch(() => '')
        const cwd = await fs.readlink(`/proc/${pid}/cwd`).catch(() => '')
        seen.push(...env.split('\0').filter((item) => item.startsWith('HOME=')), `CWD=${cwd}`)
      }
      return seen.join('\n')
    }
    const uid = String(os.userInfo().uid)
    const env = await run('ps', ['-E', '-ww', '-o', 'command=', '-U', uid])
    const cwd = await run('lsof', ['-a', '-u', uid, '-d', 'cwd', '-Fn'])
    if (env === null || cwd === null) return null
    const cwds = cwd.split('\n').filter((line) => line.startsWith('n'))
    return `${env}\n${cwds.map((line) => `CWD=${line.slice(1)}`).join('\n')}`
  }
  // Working directories are reported resolved (macOS's /var is /private/var),
  // HOME as it was given, so both spellings of the root are checked. Prefix
  // matches: a sibling sharing the prefix is kept too, which is always safe.
  const roots = [root, await fs.realpath(root).catch(() => root)]
  const used = (seen, dir, home) =>
    seen === null ||
    roots.some((at) =>
      [`HOME=${home}`, `CWD=${home}`, `CWD=${dir}`].some((item) =>
        seen.includes(item.replace(root, () => at)),
      ),
    )
  // True when anything in the tree changed after the cutoff, or cannot be read.
  const fresh = async (dir) => {
    for (const stack = [dir]; stack.length;) {
      const at = stack.pop()
      const stat = await fs.lstat(at).catch(() => null)
      if (!stat) continue
      if (stat.mtimeMs > cutoff) return true
      if (!stat.isDirectory()) continue
      const names = await fs.readdir(at).catch(() => null)
      if (!names) return true
      stack.push(...names.map((name) => path.join(at, name)))
    }
    return false
  }
  // Never follows a symlink: a link is removed, not what it points to. Never
  // crosses into another filesystem: a mount inside a home stops its removal.
  let count = 0
  const remove = async (at, dev) => {
    const stat = await fs.lstat(at).catch(() => null)
    if (!stat) return
    if (stat.dev !== dev) throw new Error(`${at} is on another filesystem`)
    if (stat.isDirectory()) {
      await fs.chmod(at, 0o700).catch(() => {})
      for (const name of await fs.readdir(at)) await remove(path.join(at, name), dev)
      await fs.rmdir(at)
    } else await fs.unlink(at)
    if (++count % 200 === 0) await sleep(pauseMs)
  }
  // <sha256(session)>[.<sha256(actor)>], or one a reclaim left set aside.
  const homeName = /^[0-9a-f]{64}(\.[0-9a-f]{64})?(\.reclaim-\d+-[0-9a-f-]+)?$/
  const removed = []
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    // Dirent types come from lstat, so a symlink named like a home is skipped.
    if (!entry.isDirectory() || !homeName.test(entry.name)) continue
    const dir = path.join(root, entry.name)
    const home = path.join(root, entry.name.replace(/\.reclaim-.*$/, ''))
    try {
      if ((await fresh(dir)) || used(await processes(), dir, home)) continue
      // Set aside, then look again: a session that starts now gets a fresh
      // home, and one that started during the scan keeps this one.
      const aside = dir === home ? `${home}.reclaim-${Date.now()}-${randomUUID()}` : dir
      if (aside !== dir) await fs.rename(dir, aside)
      const stat = await fs.lstat(aside)
      if (!stat.isDirectory() || stat.mtimeMs > cutoff || used(await processes(), aside, home)) {
        // Not over a home a session has created since: this one stays aside
        // and is judged again by the next sweep.
        if (aside !== dir && !(await fs.lstat(dir).catch(() => null)))
          await fs.rename(aside, dir).catch(() => {})
        continue
      }
      await remove(aside, stat.dev)
      removed.push(entry.name)
    } catch {
      /* Taken by another sweep, or partly removed; the next sweep retries. */
    }
    await sleep(pauseMs)
  }
  return removed
}
