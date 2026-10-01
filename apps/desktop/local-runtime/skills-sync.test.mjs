import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { patchDesktopAdapter } from './adapter-patches.mjs'
import { nuphosLocalSyncSkills } from './skills-sync.mjs'

const params = {
  _meta: {
    claudeCode: {
      options: {
        env: {
          NUPHOS_RUNTIME_SKILLS_URL:
            'https://api.example.com/internal/claude-code-runtime-skills/t1',
          NUPHOS_RUNTIME_SKILLS_TOKEN: 'token',
        },
      },
    },
  },
}

function bundle(revision, files) {
  return new Response(JSON.stringify({ revision, files }), { status: 200 })
}

function file(path, text) {
  return { path, contentBase64: Buffer.from(text).toString('base64') }
}

test('installs the team bundle into the workspace and skips an unchanged revision', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'skills-'))
  const requests = []

  t.mock.method(globalThis, 'fetch', (url, init) => {
    requests.push(init.headers)

    return Promise.resolve(
      requests.length === 1
        ? bundle('r1', [file('deploy/SKILL.md', '# Deploy'), file('_runtime/settings.json', '{}')])
        : new Response(null, { status: 304 }),
    )
  })

  assert.equal(await nuphosLocalSyncSkills(params, { workspace }), true)
  assert.equal(
    readFileSync(join(workspace, '.claude', 'skills', 'deploy', 'SKILL.md'), 'utf8'),
    '# Deploy',
  )
  assert.equal(readFileSync(join(workspace, '.claude', 'settings.json'), 'utf8'), '{}')
  assert.equal(await nuphosLocalSyncSkills(params, { workspace }), true)
  assert.equal(requests[1]['if-none-match'], '"r1"')
  assert.equal(requests[0].authorization, 'Bearer token')
})

test('a newer revision replaces the old tree', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'skills-'))
  let revision = 0

  t.mock.method(globalThis, 'fetch', () => {
    revision += 1

    return Promise.resolve(bundle(`r${String(revision)}`, [file(`s${String(revision)}.md`, 'x')]))
  })
  await nuphosLocalSyncSkills(params, { workspace })
  await nuphosLocalSyncSkills(params, { workspace })

  assert.deepEqual(readdirSync(join(workspace, '.claude', 'skills')), ['s2.md'])
  assert.equal(
    readdirSync(join(workspace, '.claude')).filter((name) => name.startsWith('skills.')).length,
    1,
  )
})

test('refuses paths that escape the skills tree', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'skills-'))

  t.mock.method(globalThis, 'fetch', () => Promise.resolve(bundle('r1', [file('../evil', 'x')])))

  assert.equal(await nuphosLocalSyncSkills(params, { workspace }), false)
  assert.deepEqual(readdirSync(workspace).includes('evil'), false)
})

test('does nothing without a skills credential', async () => {
  assert.equal(await nuphosLocalSyncSkills({}, { workspace: tmpdir() }), false)
})

test('the adapter patch points the bridge and skills sync at the desktop bundle', () => {
  const source = [
    '#!/usr/bin/env node',
    "      args: ['/opt/nuphos-runtime/mcp-http-bridge.mjs', server.url],",
    "      env: [{ name: 'OPENAB_CREDENTIALS_DIR', value: dir }],",
    '    await nuphosSyncRuntimeSkills(params);',
  ].join('\n')
  const patched = patchDesktopAdapter(source)

  assert.ok(patched.startsWith('#!/usr/bin/env node\nasync function nuphosLocalSyncSkills('))
  assert.match(patched, /env\.NUPHOS_MCP_BRIDGE/u)
  assert.match(patched, /ELECTRON_RUN_AS_NODE/u)
  assert.match(patched, /await nuphosLocalSyncSkills\(params\);/u)
  assert.throws(() => patchDesktopAdapter('nothing to patch'))
})
