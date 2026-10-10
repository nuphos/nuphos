// Stages what the Local runtime ships inside the app, per target:
//   build/local-runtime/<platform>-<arch>/{openab[.exe], adapters/<agent>/, manifest.json}
//
//   node local-runtime/prepare.mjs [--targets darwin-arm64,darwin-x64] [--openab <binary> | --no-openab] [--require]
//
// The adapters are this repository's apps/runtime/image adapters, patched as
// the image patches them.
// openab is built from zeabur/openab at a pinned commit unless --openab (or
// NUPHOS_OPENAB_BINARY) supplies one. Its build lives in ~/.cache/nuphos, so
// every checkout on this computer shares it. Without --require a target that cannot
// get an openab binary is staged without one, and the app reports the Local
// runtime as unavailable in that build.
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { patchDesktopAdapter } from './adapter-patches.mjs'
import { findBrokenLinks } from './bundle-check.mjs'
import { bundleStamp, RUNTIME_DIR, RUNTIME_SOURCES } from './bundle-stamp.mjs'

export const OPENAB_COMMIT = 'e73676eed5551d2364bc4575bdcf50827c80c226'

/** One nuphos-runtime adapter per agent the desktop can run, patched as its image patches it. */
export const ADAPTERS = {
  'claude-code': {
    dir: 'claude-agent-acp',
    patchTarget: 'node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js',
    entry: 'node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js',
    version: 'claude-agent-acp@0.74.0',
  },
  codex: {
    dir: 'codex-acp',
    patchTarget: 'node_modules/@agentclientprotocol/codex-acp/dist/index.js',
    entry: 'node_modules/@agentclientprotocol/codex-acp/dist/index.js',
    version: 'codex-acp@1.1.4',
  },
}
const RUST_TARGETS = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)))
const outRoot = join(desktopDir, 'build', 'local-runtime')
const cache = join(outRoot, '.cache')

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'npm',
  })
}

function hasCommand(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })

    return true
  } catch {
    return false
  }
}

async function buildAdapter(provider) {
  const adapter = ADAPTERS[provider]
  const out = join(cache, `adapter-${provider}-${bundleStamp()}`)

  if (existsSync(join(out, '.complete'))) return out
  const work = join(cache, `adapter-work-${provider}`)

  rmSync(work, { recursive: true, force: true })
  for (const file of RUNTIME_SOURCES) {
    mkdirSync(dirname(join(work, file)), { recursive: true })
    cpSync(join(RUNTIME_DIR, file), join(work, file))
  }
  const adapterDir = join(work, adapter.dir)

  run(
    'npm',
    ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'],
    adapterDir,
  )
  const target = join(adapterDir, adapter.patchTarget)

  run(process.execPath, ['patch-adapter.mjs', target], adapterDir)
  writeFileSync(target, patchDesktopAdapter(readFileSync(target, 'utf8'), provider))
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  rmSync(join(adapterDir, 'node_modules', '.bin'), { recursive: true, force: true })
  cpSync(join(adapterDir, 'node_modules'), join(out, 'node_modules'), {
    recursive: true,
    verbatimSymlinks: true,
  })
  cpSync(join(adapterDir, 'package.json'), join(out, 'package.json'))
  cpSync(join(work, 'mcp-http-bridge.mjs'), join(out, 'mcp-http-bridge.mjs'))
  writeFileSync(join(out, '.complete'), '')
  rmSync(work, { recursive: true, force: true })

  return out
}

function buildOpenab(target) {
  const triple = RUST_TARGETS[target]

  if (!triple || !hasCommand('cargo')) return null
  const source = join(homedir(), '.cache', 'nuphos', `openab-${OPENAB_COMMIT}`)

  if (!existsSync(join(source, 'Cargo.toml'))) {
    rmSync(source, { recursive: true, force: true })
    mkdirSync(source, { recursive: true })
    run('git', ['init', '-q'], source)
    run(
      'git',
      ['fetch', '-q', '--depth', '1', 'https://github.com/zeabur/openab.git', OPENAB_COMMIT],
      source,
    )
    run('git', ['checkout', '-q', 'FETCH_HEAD'], source)
  }
  if (hasCommand('rustup')) run('rustup', ['target', 'add', triple], source)
  run(
    'cargo',
    ['build', '--release', '--locked', '--features', 'unified', '--target', triple],
    source,
  )

  return join(
    source,
    'target',
    triple,
    'release',
    target.startsWith('win32') ? 'openab.exe' : 'openab',
  )
}

export async function prepare({ targets, openab, skipOpenab, require }) {
  const adapters = {}

  for (const provider of Object.keys(ADAPTERS)) adapters[provider] = await buildAdapter(provider)

  for (const target of targets) {
    const final = join(outRoot, target)
    const out = `${final}.staging`
    const binaryName = target.startsWith('win32') ? 'openab.exe' : 'openab'

    rmSync(out, { recursive: true, force: true })
    mkdirSync(out, { recursive: true })
    for (const [provider, dir] of Object.entries(adapters))
      cpSync(dir, join(out, 'adapters', provider), {
        recursive: true,
        verbatimSymlinks: true,
        filter: (path) => !path.endsWith('.complete'),
      })
    if (target.startsWith('darwin')) {
      const arch = target.endsWith('arm64') ? 'arm64' : 'x86_64'

      run(
        'xcrun',
        [
          'swiftc',
          '-O',
          '-target',
          `${arch}-apple-macosx12.0`,
          join(desktopDir, 'local-runtime', 'computer-use-permission.swift'),
          '-o',
          join(out, 'cua-permission'),
        ],
        desktopDir,
      )
    }
    const binary = skipOpenab ? null : (openab ?? buildOpenab(target))

    if (binary) {
      cpSync(binary, join(out, binaryName))
      chmodSync(join(out, binaryName), 0o755)
    } else if (require) {
      throw new Error(`No openab binary for ${target}: install a Rust toolchain or pass --openab`)
    } else {
      console.warn(
        `[local-runtime] ${target}: no openab binary; the Local runtime is unavailable in this build`,
      )
    }
    writeFileSync(
      join(out, 'manifest.json'),
      `${JSON.stringify(
        {
          stamp: bundleStamp(),
          openabCommit: OPENAB_COMMIT,
          adapters: Object.fromEntries(
            Object.entries(ADAPTERS).map(([provider, adapter]) => [
              provider,
              { entry: adapter.entry, version: adapter.version },
            ]),
          ),
          openab: binary ? binaryName : null,
        },
        null,
        2,
      )}\n`,
    )
    const broken = findBrokenLinks(out)

    if (broken.length)
      throw new Error(`${target}: symlinks that leave the bundle: ${broken.join(', ')}`)
    rmSync(final, { recursive: true, force: true })
    renameSync(out, final)
    console.log(`[local-runtime] staged ${final}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      targets: { type: 'string', default: `${process.platform}-${process.arch}` },
      openab: { type: 'string' },
      require: { type: 'boolean', default: false },
      'no-openab': { type: 'boolean', default: false },
    },
  })

  await prepare({
    targets: values.targets.split(',').filter(Boolean),
    openab: values.openab ?? process.env.NUPHOS_OPENAB_BINARY,
    skipOpenab: values['no-openab'],
    require: values.require,
  })
}
