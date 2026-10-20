import assert from 'node:assert/strict'
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { patchDesktopAdapter, patchDesktopShim } from './adapter-patches.mjs'
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

test('personal skills follow the turn’s credential and never land in the workspace', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'skills-'))
  const sessionHome = mkdtempSync(join(tmpdir(), 'skills-home-'))
  const credentialsDir = mkdtempSync(join(tmpdir(), 'skills-credentials-'))
  const credential = join(credentialsDir, 'NUPHOS_RUNTIME_SKILLS_TOKEN')
  const personal = join(sessionHome, 'personal-skills')
  const skills = join(personal, '.claude', 'skills')
  let failing = false
  // The backend answers for whoever the bearer names; `none` has no personal skills.
  const personalBundle = (bearer) => {
    const who = bearer.split('.')[1]

    if (failing) return new Response(null, { status: 500 })

    return new Response(
      JSON.stringify({
        scope: 'personal',
        revision: who,
        files:
          who === 'none'
            ? []
            : [file(`${who}/SKILL.md`, who), file('_runtime/settings.json', '{"x":1}')],
      }),
    )
  }

  t.mock.method(globalThis, 'fetch', (url, init) =>
    Promise.resolve(
      String(url).endsWith('?scope=personal')
        ? personalBundle(init.headers.authorization)
        : bundle('r1', [file('team/SKILL.md', 'T')]),
    ),
  )
  const opened = structuredClone(params)

  opened.cwd = '/workspace'
  opened._meta.claudeCode.options.env.NUPHOS_RUNTIME_SKILLS_TOKEN = 'p.owner.1.sig'
  const calls = []
  const agent = {
    sessions: { s1: { configOptions: [] } },
    teardownSession: async () => calls.push('teardown'),
    createSession: async (created, opts) => {
      calls.push(`resume ${opts.resume}`)

      return { configOptions: [] }
    },
  }
  const rebuild = ['teardown', 'resume s1']
  const prompt = async (token) => {
    calls.length = 0
    if (token === undefined) rmSync(credential, { force: true })
    else writeFileSync(credential, `${token}\n`)
    await globalThis.nuphosRefreshPersonalSkills(agent, { sessionId: 's1' })

    return [...calls]
  }

  assert.equal(
    await nuphosLocalSyncSkills(opened, { workspace, sessionHome, credentialsDir }),
    true,
  )
  assert.deepEqual(readdirSync(skills).sort(), ['_runtime', 'owner'])
  assert.deepEqual(readdirSync(join(workspace, '.claude', 'skills')), ['team'])
  // In place, so a running session keeps watching it; and no agent settings from it.
  assert.equal(lstatSync(skills).isSymbolicLink(), false)
  assert.equal(readdirSync(join(personal, '.claude')).includes('settings.json'), false)
  assert.deepEqual(opened._meta.claudeCode.options.additionalDirectories, [personal])

  // Same member under a new credential: nothing changed, nothing rebuilt.
  assert.deepEqual(await prompt('p.owner.2.sig'), [])
  // A guest's turn names nobody: the owner's skills go and the session is rebuilt.
  assert.deepEqual(await prompt('p.none.3.sig'), rebuild)
  assert.deepEqual(readdirSync(skills), [])
  assert.deepEqual(await prompt('p.owner.4.sig'), rebuild)

  // The owner's sync fails: what is installed stays. Someone else's fails: it goes.
  failing = true
  assert.deepEqual(await prompt('p.owner.5.sig'), [])
  assert.deepEqual(readdirSync(skills).sort(), ['_runtime', 'owner'])
  assert.deepEqual(await prompt('p.other.6.sig'), rebuild)
  assert.deepEqual(readdirSync(skills), [])
  failing = false

  // A prompt without its own credential never falls back to the session's.
  assert.deepEqual(await prompt('p.owner.7.sig'), rebuild)
  assert.deepEqual(await prompt(undefined), rebuild)
  assert.deepEqual(readdirSync(skills), [])
  // With no personal skills on either side, switching senders rebuilds nothing.
  assert.deepEqual(await prompt('p.none.8.sig'), [])

  // The adapter process is replaced and a guest's turn reopens the session while the
  // owner's skills are still in the home. The guest's sync fails: nothing here has
  // synced yet, so the tree cannot be trusted and is emptied.
  assert.deepEqual(await prompt('p.owner.9.sig'), rebuild)
  assert.deepEqual(readdirSync(skills).sort(), ['_runtime', 'owner'])
  failing = true
  writeFileSync(credential, 'p.none.10.sig\n')
  const reopened = structuredClone(opened)

  reopened._meta.claudeCode.options.env.NUPHOS_RUNTIME_SKILLS_TOKEN = 'p.none.10.sig'
  await nuphosLocalSyncSkills(reopened, { workspace, sessionHome, credentialsDir })
  assert.deepEqual(readdirSync(skills), [])
  delete globalThis.nuphosRefreshPersonalSkills
})

test('the staged ACP shim keeps its #! line first and syncs skills through the desktop', () => {
  const source = readFileSync(new URL('../../runtime/image/acp-shim.mjs', import.meta.url), 'utf8')
  const patched = patchDesktopShim(source)

  assert.ok(patched.startsWith('#!/usr/bin/env node\n'))
  assert.ok(patched.includes('await nuphosLocalSyncSkills(message.params)'))
  assert.ok(patched.includes(nuphosLocalSyncSkills.toString()))
})
