#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const HERE = dirname(SELF)
export const DEFAULT_ROOT = '/home/node/.nuphos-runtime/tools'
export const BAKED_ROOT = '/usr/local/lib/nuphos-tools'
const ARCHES = { x64: 'amd64', arm64: 'arm64' }
const TRIPLETS = { amd64: 'x86_64-linux-gnu', arm64: 'aarch64-linux-gnu' }
const LOCK_BUSY = 75
const LOCK_WAIT_SECONDS = 1800

export function loadManifest(file = join(HERE, 'manifest.json')) {
  return JSON.parse(readFileSync(file, 'utf8')).tools
}

export function toolsRoot(env = process.env) {
  return env.NUPHOS_TOOLS_DIR || DEFAULT_ROOT
}

export function hostArch(arch = process.arch) {
  const mapped = ARCHES[arch]
  if (!mapped) throw new Error(`unsupported architecture ${arch}`)
  return mapped
}

const toolDir = (root, name, tool) => join(root, name, tool.version)

function quote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

function expand(template, vars) {
  return template.replaceAll(/\{(\w+)\}/g, (match, key) => vars[key] ?? match)
}

function commandSpec(spec) {
  return typeof spec === 'string' ? { path: spec, args: [] } : { args: [], ...spec }
}

export function renderShim(name, tool, command) {
  return [
    '#!/bin/sh',
    `# ${command} is installed on first use; see nuphos-tools list.`,
    `t="\${NUPHOS_TOOLS_DIR:-${DEFAULT_ROOT}}/${name}/${tool.version}/.bin/${command}"`,
    `[ -x "$t" ] || /usr/local/bin/nuphos-tools install ${name} || exit`,
    'exec "$t" "$@"',
    '',
  ].join('\n')
}

export function renderLauncher(tool, command, vars) {
  const spec = commandSpec(tool.commands[command])
  const lines = ['#!/bin/sh']
  for (const [key, value] of Object.entries(tool.env ?? {}))
    lines.push(`export ${key}=${quote(expand(value, vars))}`)
  const argv = [join(vars.dir, spec.path), ...spec.args.map((arg) => expand(arg, vars))]
  lines.push(`exec ${argv.map(quote).join(' ')} "$@"`, '')
  return lines.join('\n')
}

function log(message) {
  process.stderr.write(`nuphos-tools: ${message}\n`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: ['ignore', 2, 2], ...options })
  if (result.error) throw new Error(`${command}: ${result.error.message}`)
  if (result.status !== 0)
    throw new Error(`${command} ${args[0] ?? ''} exited with ${result.status ?? result.signal}`)
}

export function curlDownload(url, file) {
  run('curl', [
    '-fsSL',
    '--proto',
    '=https',
    '--tlsv1.2',
    '--retry',
    '3',
    '--connect-timeout',
    '20',
    '-o',
    file,
    url,
  ])
}

export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function fetchVerified(source, file, download) {
  log(`downloading ${source.url}`)
  try {
    download(source.url, file)
  } catch (error) {
    throw new Error(
      `could not download ${source.url} (${error.message}); a first use needs network access to ${new URL(source.url).host}`,
    )
  }
  const actual = sha256File(file)
  if (actual !== source.sha256) {
    rmSync(file, { force: true })
    throw new Error(`checksum mismatch for ${source.url}: expected ${source.sha256}, got ${actual}`)
  }
}

function extract(file, dest, strip = 0) {
  mkdirSync(dest, { recursive: true })
  if (file.endsWith('.zip')) run('unzip', ['-q', '-o', file, '-d', dest])
  else run('tar', ['-xzf', file, '-C', dest, '--no-same-owner', `--strip-components=${strip}`])
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    visit(path, entry)
    if (entry.isDirectory()) walk(path, visit)
  }
}

// Packages already in the image are not extracted, so a development symlink or
// linker script can still name the system copy of a library.
export function relocateTree(root, system = '/') {
  walk(root, (path, entry) => {
    if (!entry.isSymbolicLink() || existsSync(path)) return
    const target = readlinkSync(path)
    const logical = join(system, relative(root, dirname(path)))
    const candidate = isAbsolute(target) ? join(system, target) : resolve(logical, target)
    const inTree = isAbsolute(target) ? join(root, target) : null
    const replacement =
      inTree && existsSync(inTree) ? inTree : existsSync(candidate) ? candidate : null
    if (!replacement) return
    unlinkSync(path)
    symlinkSync(replacement, path)
  })
  walk(root, (path, entry) => {
    if (!entry.isFile() || !/\.so$/.test(entry.name) || statSync(path).size > 4096) return
    const text = readFileSync(path, 'latin1')
    if (!/^\s*(\/\*|GROUP|INPUT|OUTPUT_FORMAT)/m.test(text) || text.includes('\0')) return
    const rewritten = text.replaceAll(/(?<=[\s(])\/[^\s()]+/g, (file) =>
      !existsSync(join(system, file)) && existsSync(join(root, file)) ? join(root, file) : file,
    )
    if (rewritten !== text) writeFileSync(path, rewritten)
  })
}

function installApt(tool, dir, work, vars) {
  const apt = join(work, 'apt')
  mkdirSync(join(apt, 'lists', 'partial'), { recursive: true })
  mkdirSync(join(apt, 'cache', 'archives', 'partial'), { recursive: true })
  const options = [
    '-qq',
    '-o',
    `Dir::State::Lists=${apt}/lists`,
    '-o',
    `Dir::Cache=${apt}/cache`,
    '-o',
    'Debug::NoLocking=1',
    '-o',
    'Dir::Etc::sourcelist=/etc/apt/sources.list.d/debian.sources',
    '-o',
    'Dir::Etc::sourceparts=-',
  ]
  log(`resolving ${tool.apt.join(' ')} from the Debian archive`)
  run('apt-get', [...options, 'update'])
  run('apt-get', [
    ...options,
    'install',
    '--download-only',
    '--no-install-recommends',
    '-y',
    ...tool.apt,
  ])
  const archives = join(apt, 'cache', 'archives')
  const debs = readdirSync(archives).filter((file) => file.endsWith('.deb'))
  log(`unpacking ${debs.length} verified packages`)
  const rootfs = join(dir, 'root')
  mkdirSync(rootfs, { recursive: true })
  for (const deb of debs) run('dpkg-deb', ['-x', join(archives, deb), rootfs])
  relocateTree(rootfs)
  vars.root = rootfs
}

function installPip(tool, dir) {
  const venv = join(dir, 'venv')
  run('python3', ['-m', 'venv', venv])
  run(join(venv, 'bin', 'pip'), [
    'install',
    '--quiet',
    '--no-cache-dir',
    '--disable-pip-version-check',
    '--require-hashes',
    '-r',
    join(HERE, tool.pip),
  ])
}

export function installTool(name, tool, options = {}) {
  const { root = toolsRoot(), arch = hostArch(), download = curlDownload } = options
  const dir = toolDir(root, name, tool)
  const bin = join(dir, '.bin')
  if (existsSync(bin)) return dir

  const started = Date.now()
  log(`installing ${name} ${tool.version} into ${dir} (first use; later calls reuse it)`)
  rmSync(dir, { recursive: true, force: true })
  const work = join(dir, '.work')
  mkdirSync(work, { recursive: true })
  const vars = { dir, triplet: TRIPLETS[arch], arch }
  const source = tool.downloads?.[arch]
  if (tool.downloads && !source) throw new Error(`${name} has no ${arch} build`)

  switch (tool.kind) {
    case 'archive': {
      const file = join(work, source.url.endsWith('.zip') ? 'download.zip' : 'download.tgz')
      fetchVerified(source, file, download)
      extract(file, dir, tool.strip)
      break
    }
    case 'binary': {
      const file = join(dir, commandSpec(Object.values(tool.commands)[0]).path)
      fetchVerified(source, file, download)
      chmodSync(file, 0o755)
      break
    }
    case 'aws': {
      const file = join(work, 'download.zip')
      fetchVerified(source, file, download)
      extract(file, work)
      run(join(work, 'aws', 'install'), ['-i', join(dir, 'aws-cli'), '-b', join(dir, 'bin')])
      break
    }
    case 'apt':
      installApt(tool, dir, work, vars)
      break
    case 'pip':
      installPip(tool, dir)
      break
    default:
      throw new Error(`${name}: unknown kind ${tool.kind}`)
  }

  for (const command of Object.keys(tool.commands)) {
    const target = join(dir, commandSpec(tool.commands[command]).path)
    if (!existsSync(target)) throw new Error(`${name} did not provide ${command} at ${target}`)
  }
  const staging = join(dir, '.bin.partial')
  mkdirSync(staging)
  for (const command of Object.keys(tool.commands)) {
    const launcher = join(staging, command)
    writeFileSync(launcher, renderLauncher(tool, command, vars))
    chmodSync(launcher, 0o755)
  }
  rmSync(work, { recursive: true, force: true })
  renameSync(staging, bin)

  for (const entry of readdirSync(join(root, name))) {
    if (entry !== tool.version && !entry.startsWith('.'))
      rmSync(join(root, name, entry), { recursive: true, force: true })
  }
  log(`${name} ${tool.version} ready in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  return dir
}

function lockedInstall(name, root) {
  const locks = join(root, '.locks')
  mkdirSync(locks, { recursive: true })
  const lock = join(locks, `${name}.lock`)
  const argv = [process.execPath, SELF, '__install', name]
  const opts = { stdio: ['ignore', 2, 2] }
  let result = spawnSync('flock', ['-n', '-E', String(LOCK_BUSY), lock, ...argv], opts)
  if (result.status === LOCK_BUSY) {
    log(`waiting for another process that is installing ${name}`)
    result = spawnSync(
      'flock',
      ['-w', String(LOCK_WAIT_SECONDS), '-E', String(LOCK_BUSY), lock, ...argv],
      opts,
    )
  }
  if (result.error) throw new Error(`flock: ${result.error.message}`)
  return result.status ?? 1
}

// Image build only: installs the tools marked `baked` under BAKED_ROOT and
// writes a first-use shim for every other command.
export function buildImageTools(bindir, manifest = loadManifest(), options = {}) {
  const seen = new Set()
  for (const [name, tool] of Object.entries(manifest)) {
    for (const command of Object.keys(tool.commands)) {
      if (seen.has(command)) throw new Error(`${command} is provided by two tools`)
      seen.add(command)
      const target = join(bindir, command)
      if (existsSync(target) || lstatSafe(target))
        throw new Error(`${target} already exists; a shim would shadow it`)
    }
    if (tool.baked) {
      const dir = installTool(name, tool, { root: BAKED_ROOT, ...options })
      for (const command of Object.keys(tool.commands))
        symlinkSync(join(dir, commandSpec(tool.commands[command]).path), join(bindir, command))
    } else {
      for (const command of Object.keys(tool.commands)) {
        writeFileSync(join(bindir, command), renderShim(name, tool, command))
        chmodSync(join(bindir, command), 0o755)
      }
    }
  }
}

function lstatSafe(path) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

export function toolStates(manifest, root) {
  return Object.entries(manifest).map(([name, tool]) => ({
    name,
    version: tool.version,
    state: tool.baked
      ? 'built-in'
      : existsSync(join(toolDir(root, name, tool), '.bin'))
        ? 'installed'
        : 'on-first-use',
    commands: Object.keys(tool.commands),
  }))
}

const STATE_LABELS = {
  'built-in': 'built in',
  installed: 'installed',
  'on-first-use': 'on first use',
}

function list(manifest, root, json) {
  const tools = toolStates(manifest, root)
  if (json) {
    const entries = tools.map((tool) => ({ ...tool, installed: tool.state !== 'on-first-use' }))
    process.stdout.write(`${JSON.stringify({ tools: entries })}\n`)
    return
  }
  for (const { name, version, state, commands } of tools) {
    process.stdout.write(
      `${name.padEnd(24)}${version.padEnd(12)}${STATE_LABELS[state].padEnd(14)}${commands.join(' ')}\n`,
    )
  }
}

const USAGE = `usage: nuphos-tools list [--json]
       nuphos-tools install <tool>... | --all

Tools not built into the image install into ${DEFAULT_ROOT}
(or $NUPHOS_TOOLS_DIR) the first time one of their commands runs.`

function main(argv) {
  const manifest = loadManifest()
  const root = toolsRoot()
  const [command, ...rest] = argv
  const pick = (names) => {
    const all = Object.keys(manifest).filter((name) => !manifest[name].baked)
    const wanted = names.includes('--all') ? all : names
    for (const name of wanted) {
      if (manifest[name]?.baked) throw new Error(`${name} is built into the image`)
      if (!all.includes(name)) throw new Error(`unknown tool ${name}; see nuphos-tools list`)
    }
    return wanted
  }

  switch (command) {
    case 'list':
      list(manifest, root, rest.includes('--json'))
      return 0
    case 'install': {
      const names = pick(rest)
      if (names.length === 0) throw new Error(USAGE)
      for (const name of names) {
        if (existsSync(join(toolDir(root, name, manifest[name]), '.bin'))) continue
        const status = lockedInstall(name, root)
        if (status !== 0) return status
      }
      return 0
    }
    case '__install': {
      const [name] = pick(rest)
      try {
        installTool(name, manifest[name], { root })
      } catch (error) {
        rmSync(toolDir(root, name, manifest[name]), { recursive: true, force: true })
        throw error
      }
      return 0
    }
    case 'build':
      buildImageTools(rest[0] ?? '/usr/local/bin', manifest)
      return 0
    default:
      process.stderr.write(`${USAGE}\n`)
      return command ? 2 : 0
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    log(error.message)
    process.exitCode = 1
  }
}
