import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  DEFAULT_ROOT,
  installTool,
  loadManifest,
  relocateTree,
  renderLauncher,
  renderShim,
} from '../image/tools/nuphos-tools.mjs'

const manifest = loadManifest()
const dockerfile = readFileSync(new URL('../image/Dockerfile', import.meta.url), 'utf8')
const KINDS = new Set(['archive', 'binary', 'aws', 'apt', 'pip'])

const scratch = () => mkdtempSync(join(tmpdir(), 'nuphos-tools-'))

test('every download is pinned by checksum for both published architectures', () => {
  for (const [name, tool] of Object.entries(manifest)) {
    assert.ok(KINDS.has(tool.kind), `${name} has an unknown kind`)
    assert.match(tool.version, /^\S+$/u, `${name} needs a version`)
    if (!['archive', 'binary', 'aws'].includes(tool.kind)) continue
    for (const arch of ['amd64', 'arm64']) {
      const source = tool.downloads?.[arch]
      assert.ok(source, `${name} has no ${arch} download`)
      assert.match(source.url, /^https:\/\//u, `${name} ${arch} must use https`)
      assert.match(source.sha256, /^[0-9a-f]{64}$/u, `${name} ${arch} needs a sha256`)
    }
    assert.notEqual(tool.downloads.amd64.sha256, tool.downloads.arm64.sha256)
  }
})

test('each command belongs to exactly one tool, and only plain binaries are baked', () => {
  const seen = new Map()
  for (const [name, tool] of Object.entries(manifest)) {
    for (const command of Object.keys(tool.commands)) {
      assert.ok(!seen.has(command), `${command} is claimed by ${seen.get(command)} and ${name}`)
      seen.set(command, name)
    }
    if (tool.baked) assert.equal(tool.kind, 'binary', `${name} is baked but needs an installer`)
  }
  for (const core of ['kubectl', 'zeabur']) assert.ok(manifest[seen.get(core)].baked)
})

test('the pip lock pins every requirement by hash', () => {
  const tool = manifest['linode-cli']
  const lock = readFileSync(new URL(`../image/tools/${tool.pip}`, import.meta.url), 'utf8')
  assert.ok(lock.includes(`linode-cli==${tool.version} \\`))
  const requirements = lock.split('\n').filter((line) => /^[a-z0-9]/iu.test(line))
  assert.ok(requirements.length > 1)
  for (const requirement of requirements) assert.match(requirement, /==\S+ \\$/u)
  assert.equal(lock.split('--hash=sha256:').length - 1 >= requirements.length, true)
})

test('a shim runs the installed launcher directly once the tool is present', () => {
  const root = scratch()
  const tool = { version: '1.0.0', commands: { demo: 'demo' } }
  const shim = join(root, 'shim')
  writeFileSync(shim, renderShim('demo-tool', tool, 'demo'))
  chmodSync(shim, 0o755)
  assert.ok(
    renderShim('demo-tool', tool, 'demo').includes(`:-${DEFAULT_ROOT}}/demo-tool/1.0.0/.bin/demo`),
  )

  const bin = join(root, 'demo-tool', '1.0.0', '.bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'demo'), '#!/bin/sh\nprintf "%s|" "$@"\n')
  chmodSync(join(bin, 'demo'), 0o755)
  const out = execFileSync(shim, ['a b', 'c'], {
    env: { NUPHOS_TOOLS_DIR: root, PATH: '/usr/bin:/bin' },
  })
  assert.equal(out.toString(), 'a b|c|')
})

test('a launcher exports the tool environment and prepends fixed arguments', () => {
  const tool = {
    env: { LD_LIBRARY_PATH: '{root}/usr/lib/{triplet}' },
    commands: { cc: { path: 'root/usr/bin/gcc', args: ['-idirafter', '{root}/usr/include'] } },
  }
  const launcher = renderLauncher(tool, 'cc', {
    dir: "/t/it's",
    root: "/t/it's/root",
    triplet: 'x86_64-linux-gnu',
  })
  assert.equal(
    launcher,
    [
      '#!/bin/sh',
      `export LD_LIBRARY_PATH='/t/it'\\''s/root/usr/lib/x86_64-linux-gnu'`,
      `exec '/t/it'\\''s/root/usr/bin/gcc' '-idirafter' '/t/it'\\''s/root/usr/include' "$@"`,
      '',
    ].join('\n'),
  )
})

function fixtureArchive(dir, version) {
  const src = join(dir, `src-${version}`, `demo-${version}`)
  mkdirSync(join(src, 'bin'), { recursive: true })
  writeFileSync(join(src, 'bin', 'demo'), `#!/bin/sh\necho demo ${version}\n`)
  chmodSync(join(src, 'bin', 'demo'), 0o755)
  const file = join(dir, `demo-${version}.tgz`)
  execFileSync('tar', ['-czf', file, '-C', join(dir, `src-${version}`), `demo-${version}`])
  return { file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }
}

function archiveTool(version, fixture) {
  const source = { url: `https://example.invalid/demo-${version}.tgz`, sha256: fixture.sha256 }
  return {
    version,
    kind: 'archive',
    strip: 1,
    downloads: { amd64: source, arm64: source },
    commands: { demo: 'bin/demo' },
  }
}

test('an archive installs once, verifies its checksum and replaces the previous version', () => {
  const root = scratch()
  const downloads = []
  const fake = (fixture) => (url, file) => {
    downloads.push(url)
    copyFileSync(fixture.file, file)
  }
  const quiet = { root, arch: 'amd64' }
  const stderr = process.stderr.write
  process.stderr.write = () => true
  try {
    const one = fixtureArchive(root, '1.0.0')
    installTool('demo', archiveTool('1.0.0', one), { ...quiet, download: fake(one) })
    installTool('demo', archiveTool('1.0.0', one), { ...quiet, download: fake(one) })
    assert.equal(downloads.length, 1)
    assert.equal(
      execFileSync(join(root, 'demo', '1.0.0', '.bin', 'demo')).toString(),
      'demo 1.0.0\n',
    )

    const two = fixtureArchive(root, '2.0.0')
    installTool('demo', archiveTool('2.0.0', two), { ...quiet, download: fake(two) })
    assert.ok(!existsSync(join(root, 'demo', '1.0.0')))
    assert.ok(existsSync(join(root, 'demo', '2.0.0', '.bin', 'demo')))

    const tampered = { ...archiveTool('3.0.0', two) }
    tampered.downloads = { amd64: { ...tampered.downloads.amd64, sha256: '0'.repeat(64) } }
    assert.throws(
      () => installTool('demo', tampered, { ...quiet, download: fake(two) }),
      /checksum mismatch/u,
    )
    assert.ok(!existsSync(join(root, 'demo', '3.0.0', '.bin')))
    assert.ok(existsSync(join(root, 'demo', '2.0.0', '.bin', 'demo')))
  } finally {
    process.stderr.write = stderr
  }
})

test('unpacked packages fall back to the libraries the image already has', () => {
  const system = scratch()
  const root = scratch()
  const lib = 'usr/lib/x86_64-linux-gnu'
  mkdirSync(join(system, lib), { recursive: true })
  mkdirSync(join(root, lib), { recursive: true })
  writeFileSync(join(system, lib, 'libcrypt.so.1'), 'system')
  symlinkSync('libcrypt.so.1', join(root, lib, 'libcrypt.so'))
  writeFileSync(join(root, lib, 'libc_nonshared.a'), 'archive')
  writeFileSync(
    join(root, lib, 'libc.so'),
    `/* GNU ld script */\nGROUP ( /lib/x86_64-linux-gnu/libc.so.6 /${lib}/libc_nonshared.a )\n`,
  )

  relocateTree(root, system)

  assert.equal(readlinkSync(join(root, lib, 'libcrypt.so')), join(system, lib, 'libcrypt.so.1'))
  assert.equal(
    readFileSync(join(root, lib, 'libc.so'), 'utf8'),
    `/* GNU ld script */\nGROUP ( /lib/x86_64-linux-gnu/libc.so.6 ${join(root, lib, 'libc_nonshared.a')} )\n`,
  )
})

test('the image carries one agent CLI and reports the adapter it actually runs', () => {
  for (const [dir, adapter] of [
    ['claude-agent-acp', '@agentclientprotocol/claude-agent-acp'],
    ['codex-acp', '@agentclientprotocol/codex-acp'],
  ]) {
    const pkg = JSON.parse(
      readFileSync(new URL(`../image/${dir}/package.json`, import.meta.url), 'utf8'),
    )
    const name = adapter.split('/')[1]
    assert.ok(dockerfile.includes(`OPENAB_ADAPTER_VERSION="${name}@${pkg.dependencies[adapter]}"`))
  }
  assert.match(dockerfile, /^FROM \$\{BASE_IMAGE:[^\n]* AS openab$/mu)
  assert.match(
    dockerfile,
    /^COPY --from=openab \/usr\/local\/bin\/openab \/usr\/local\/bin\/openab$/mu,
  )
  assert.match(dockerfile, /^FROM \$\{RUNTIME_PROVIDER\}$/mu)
  assert.match(dockerfile, /claude-agent-sdk-linux-\*-musl/u)
  assert.doesNotMatch(dockerfile, /npm install -g/u)
  assert.doesNotMatch(dockerfile, /chown -R/u)
  for (const install of dockerfile.matchAll(/npm ci [^\n]*/gu))
    assert.match(
      install[0],
      /--cache \/tmp\/npm-cache/u,
      'npm must not leave its cache in /home/node',
    )
})

test('list --json reports every tool with its state for the runtime console', () => {
  const root = scratch()
  const lazy = Object.entries(manifest).find(([, tool]) => !tool.baked)
  mkdirSync(join(root, lazy[0], lazy[1].version, '.bin'), { recursive: true })
  const cli = new URL('../image/tools/nuphos-tools.mjs', import.meta.url).pathname
  const out = execFileSync(process.execPath, [cli, 'list', '--json'], {
    env: { NUPHOS_TOOLS_DIR: root, PATH: '/usr/bin:/bin' },
  }).toString()
  const { tools } = JSON.parse(out)
  assert.deepEqual(
    tools.map((tool) => tool.name),
    Object.keys(manifest),
  )
  for (const tool of tools) {
    const expected = manifest[tool.name].baked
      ? 'built-in'
      : tool.name === lazy[0]
        ? 'installed'
        : 'on-first-use'
    assert.equal(tool.state, expected, tool.name)
    assert.equal(tool.installed, expected !== 'on-first-use', tool.name)
    assert.equal(tool.version, manifest[tool.name].version)
    assert.deepEqual(tool.commands, Object.keys(manifest[tool.name].commands))
  }
})

test('the image allowlists the tools job the console reads', () => {
  assert.match(
    dockerfile,
    /^ENV OPENAB_RUNTIME_JOBS="[^"\n]*;tools=node \/opt\/nuphos-runtime\/tools\/nuphos-tools\.mjs list --json"/mu,
  )
})
