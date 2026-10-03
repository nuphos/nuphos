import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { nuphosSyncRuntimeSkills, patchRuntimeDefaults } from '../image/runtime-defaults.mjs'

/** Stand in for /usr/local/bin/nuphos-sync-skills by recording what it was handed. */
async function withFakeScript(body, run) {
  const directory = await mkdtemp(join(tmpdir(), 'nuphos-skills-test-'))
  const script = join(directory, 'nuphos-sync-skills')
  const record = join(directory, 'record.json')

  await writeFile(script, `#!/bin/sh\n${body}\n`)
  await chmod(script, 0o755)
  try {
    return await run({ directory, script, record })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const meta = (env, provider = 'claudeCode') =>
  provider === 'claudeCode'
    ? { _meta: { claudeCode: { options: { env } } } }
    : { _meta: { 'ai.nuphos/codex': { env } } }

test('a session carrying a bundle credential syncs, and one without it does not', async () => {
  await withFakeScript('printenv > "$NUPHOS_TEST_RECORD"', async ({ record, script }) => {
    const sync = (params) =>
      nuphosSyncRuntimeSkills(params, { script, env: { NUPHOS_TEST_RECORD: record } })

    // Managed pods carry neither variable and must not be touched at all.
    assert.equal(await sync({}), false)
    assert.equal(await sync(meta({})), false)
    assert.equal(await sync(meta({ NUPHOS_RUNTIME_SKILLS_URL: 'https://x' })), false)
    assert.equal(await sync(meta({ NUPHOS_RUNTIME_SKILLS_TOKEN: 't' })), false)
    await assert.rejects(readFile(record), { code: 'ENOENT' })

    assert.equal(
      await sync(
        meta({ NUPHOS_RUNTIME_SKILLS_URL: 'https://bundle', NUPHOS_RUNTIME_SKILLS_TOKEN: 'tok' }),
      ),
      true,
    )
    const env = await readFile(record, 'utf8')

    assert.match(env, /^NUPHOS_RUNTIME_SKILLS_URL=https:\/\/bundle$/mu)
    assert.match(env, /^NUPHOS_RUNTIME_SKILLS_TOKEN=tok$/mu)
    // The bundle credential is all the script needs; the agent's own account and the
    // runtime's transport keys must not ride along.
    assert.deepEqual(
      env
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(0, line.indexOf('=')))
        // `sh` sets these three itself; everything else present would be inherited.
        .filter((name) => !['PWD', 'SHLVL', '_'].includes(name))
        .filter((name) => !name.startsWith('NUPHOS_TEST'))
        .sort(),
      ['HOME', 'NUPHOS_RUNTIME_SKILLS_TOKEN', 'NUPHOS_RUNTIME_SKILLS_URL', 'PATH'],
    )
  })
})

test('a session cannot choose the workspace the sync writes to', async () => {
  await withFakeScript(
    'printenv > "$NUPHOS_TEST_RECORD"',
    async ({ record, script, directory }) => {
      // The script mkdirs under this path, replaces files in it and recursively removes
      // trees beneath it. A session-chosen value would be a write primitive aimed
      // wherever the caller liked, so it must not survive into the child at all.
      assert.equal(
        await nuphosSyncRuntimeSkills(
          meta({
            NUPHOS_RUNTIME_SKILLS_URL: 'https://bundle',
            NUPHOS_RUNTIME_SKILLS_TOKEN: 'tok',
            NUPHOS_RUNTIME_WORKSPACE: join(directory, 'somewhere-else'),
          }),
          { script, env: { NUPHOS_TEST_RECORD: record } },
        ),
        true,
      )
      assert.doesNotMatch(await readFile(record, 'utf8'), /NUPHOS_RUNTIME_WORKSPACE/u)
    },
  )
})

test('the Codex session shape is read too', async () => {
  await withFakeScript('printenv > "$NUPHOS_TEST_RECORD"', async ({ record, script }) => {
    assert.equal(
      await nuphosSyncRuntimeSkills(
        meta(
          { NUPHOS_RUNTIME_SKILLS_URL: 'https://codex', NUPHOS_RUNTIME_SKILLS_TOKEN: 'ct' },
          'codex',
        ),
        { script, env: { NUPHOS_TEST_RECORD: record } },
      ),
      true,
    )
    assert.match(await readFile(record, 'utf8'), /^NUPHOS_RUNTIME_SKILLS_URL=https:\/\/codex$/mu)
  })
})

test('a failing or hanging sync never stops the conversation', async () => {
  const carrying = meta({
    NUPHOS_RUNTIME_SKILLS_URL: 'https://bundle',
    NUPHOS_RUNTIME_SKILLS_TOKEN: 'tok',
  })

  await withFakeScript('exit 7', async ({ script }) => {
    assert.equal(await nuphosSyncRuntimeSkills(carrying, { script }), false)
  })
  // The script allows itself two minutes; session/new must not wait that long. The
  // fetch is a child of the script, so the whole group has to go.
  await withFakeScript('sleep 120 & wait', async ({ script }) => {
    const started = Date.now()

    assert.equal(await nuphosSyncRuntimeSkills(carrying, { script, timeoutMs: 300 }), false)
    assert.ok(Date.now() - started < 10_000)
  })
  // A missing script is the ordinary case on an image that ships no sync at all.
  assert.equal(
    await nuphosSyncRuntimeSkills(carrying, { script: '/nonexistent/nuphos-sync-skills' }),
    false,
  )
})

test('session/new, session/load and session/resume all sync, and only new applies defaults', async () => {
  const source = `#!/usr/bin/env node
class Agent {
    async newSession(params) { return { sessionId: params.id, configOptions: [{ id: 'model', currentValue: 'a', options: [{ value: 'a' }, { value: 'b' }] }] }; }
    async setSessionConfigOption(params) { return { configOptions: [{ id: 'model', currentValue: params.value, options: [{ value: 'a' }, { value: 'b' }] }] }; }
    async loadSession(params) { return 'loaded'; }
    async resumeSession(params) { return 'resumed'; }
  }`
  const patched = patchRuntimeDefaults(source)

  assert.ok(patched.includes('async function nuphosSyncRuntimeSkills'))
  assert.equal(patched.split('await nuphosSyncRuntimeSkills(params);').length, 4)
  for (const handler of ['newSession', 'loadSession', 'resumeSession'])
    assert.equal(patched.split(`async ${handler}(params) {`).length, 2)
  for (const handler of ['loadSession', 'resumeSession'])
    assert.throws(
      () => patchRuntimeDefaults(source.replace(`async ${handler}(params) {`, '')),
      /exactly one/,
    )

  // The patched call hands the child nothing but the bundle credential, so the fake
  // script records into a path written into its own body.
  await withFakeScript('', async ({ record, script }) => {
    await writeFile(script, `#!/bin/sh\necho "$NUPHOS_RUNTIME_SKILLS_URL" >> '${record}'\n`)
    const module = await import(
      `data:text/javascript,${encodeURIComponent(
        `${patched.replace("'/usr/local/bin/nuphos-sync-skills'", JSON.stringify(script))}\nexport { Agent }`,
      )}`
    )
    const agent = new module.Agent()
    const carrying = (url) =>
      meta({ NUPHOS_RUNTIME_SKILLS_URL: url, NUPHOS_RUNTIME_SKILLS_TOKEN: 't' })

    const session = await agent.newSession({
      id: 'a',
      _meta: { ...carrying('https://new')._meta, 'ai.nuphos/runtimeDefaults': { model: 'b' } },
    })
    assert.equal(session.configOptions[0].currentValue, 'b')
    assert.equal(await agent.loadSession({ sessionId: 'a', ...carrying('https://load') }), 'loaded')
    assert.equal(
      await agent.resumeSession({ sessionId: 'a', ...carrying('https://resume') }),
      'resumed',
    )
    // A reopen without a credential, as on a managed pod, stays untouched.
    assert.equal(await agent.loadSession({ sessionId: 'a' }), 'loaded')

    assert.deepEqual((await readFile(record, 'utf8')).split('\n').filter(Boolean), [
      'https://new',
      'https://load',
      'https://resume',
    ])
  })
})
