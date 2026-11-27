import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import {
  nuphosSyncRuntimeSkills,
  patchSkillsRefresh,
  patchRuntimeDefaults,
} from '../image/runtime-defaults.mjs'

/** Waits for the fetch the session itself never waits for. */
const synced = async (params, run) => (await nuphosSyncRuntimeSkills(params, run)).synced

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

const bundleSession = meta({
  NUPHOS_RUNTIME_SKILLS_URL: 'https://bundle',
  NUPHOS_RUNTIME_SKILLS_TOKEN: 'tok',
})

/** A workspace whose team bundle is already installed, as a 304 leaves it. */
async function withInstalledBundle(run) {
  const workspace = await mkdtemp(join(tmpdir(), 'nuphos-workspace-'))

  await mkdir(join(workspace, '.claude/skills/kept'), { recursive: true })
  await writeFile(join(workspace, '.claude/skills/kept/SKILL.md'), '# One')
  await writeFile(join(workspace, '.claude/.skills-revision'), 'rev-1')
  try {
    return await run(workspace)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

/** Wait for something a sync that outlived the session writes. */
async function waitFor(predicate, timeoutMs = 10_000) {
  const started = Date.now()

  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error('condition never became true')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

test('a session carrying a bundle credential syncs, and one without it does not', async () => {
  await withFakeScript('printenv > "$NUPHOS_TEST_RECORD"', async ({ record, script }) => {
    const sync = (params) => synced(params, { script, env: { NUPHOS_TEST_RECORD: record } })

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
        await synced(
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

test('personal skills follow the turn’s credential, and a prompt never rebuilds the session', async () => {
  // The fake installs one skill named after whoever the credential names; `none` has none.
  const install = [
    '[ -n "$NUPHOS_RUNTIME_PERSONAL_SKILLS_DIR" ] || exit 0',
    '[ ! -e "$NUPHOS_TEST_RECORD.fail" ] || exit 1',
    'd="$NUPHOS_RUNTIME_PERSONAL_SKILLS_DIR/.claude"',
    'who=$(printf %s "$NUPHOS_RUNTIME_SKILLS_TOKEN" | cut -d. -f2)',
    'rm -rf "$d/skills"; mkdir -p "$d/skills"',
    '[ "$who" = none ] || mkdir "$d/skills/$who"',
    'printf %s "$who" > "$d/.skills-revision"',
  ].join('\n')

  await withFakeScript(install, async ({ script, directory, record }) => {
    const personal = join(directory, 'personal-skills')
    const skills = join(personal, '.claude/skills')
    const credentialsDir = join(directory, 'credentials')
    const credential = join(credentialsDir, 'NUPHOS_RUNTIME_SKILLS_TOKEN')
    const params = meta({
      NUPHOS_RUNTIME_SKILLS_URL: 'https://bundle',
      NUPHOS_RUNTIME_SKILLS_TOKEN: 'p.owner.1.sig',
    })

    params.cwd = '/workspace'
    const run = {
      script,
      sessionHome: directory,
      credentialsDir,
      env: { NUPHOS_TEST_RECORD: record },
    }
    const calls = []
    const agent = {
      sessions: { s1: {} },
      teardownSession: async (id) => calls.push(['teardown', id]),
      createSession: async (created, opts) => calls.push(['create', created.cwd, opts.resume]),
    }
    // One prompt with the given credential file; returns what the session went through.
    const prompt = async (token) => {
      calls.length = 0
      if (token === undefined) await rm(credential, { force: true })
      else await writeFile(credential, `${token}\n`)
      await globalThis.nuphosRefreshSkills(agent, { sessionId: 's1' })

      return [...calls]
    }

    // Opening the session may use the credential it came with.
    await mkdir(credentialsDir)
    assert.equal(await synced(params, run), true)
    assert.deepEqual(params._meta.claudeCode.options.additionalDirectories, [personal])
    assert.deepEqual(await readdir(skills), ['owner'])

    // The owner again, under a freshly minted credential: nothing changes.
    assert.deepEqual(await prompt('p.owner.2.sig'), [])

    // A guest’s turn names nobody: the owner’s skills go, and the session stays as it is.
    assert.deepEqual(await prompt('p.none.3.sig'), [])
    assert.deepEqual(await readdir(skills), [])

    // Back to the owner: installed again.
    assert.deepEqual(await prompt('p.owner.4.sig'), [])
    assert.deepEqual(await readdir(skills), ['owner'])

    // The owner's sync fails: skills are never fatal, so what is installed stays.
    await writeFile(`${record}.fail`, '')
    assert.deepEqual(await prompt('p.owner.5.sig'), [])
    assert.deepEqual(await readdir(skills), ['owner'])

    // Someone else's sync fails: the owner's skills must not stay for that turn.
    assert.deepEqual(await prompt('p.other.6.sig'), [])
    assert.deepEqual(await readdir(skills), [])
    await rm(`${record}.fail`)

    // A prompt without its own credential never falls back to the one the session
    // opened with.
    assert.deepEqual(await prompt('p.owner.7.sig'), [])
    assert.deepEqual(await prompt(undefined), [])
    assert.deepEqual(await readdir(skills), [])

    // With no personal skills on either side, switching senders changes nothing.
    assert.deepEqual(await prompt('p.none.8.sig'), [])
    assert.deepEqual(await prompt(undefined), [])

    // The adapter process is replaced and a guest's turn reopens the session while the
    // owner's skills are still in the home. The guest's sync fails: nothing here has
    // synced yet, so the tree cannot be trusted and is emptied.
    assert.deepEqual(await prompt('p.owner.9.sig'), [])
    assert.deepEqual(await readdir(skills), ['owner'])
    await writeFile(`${record}.fail`, '')
    await writeFile(credential, 'p.none.10.sig\n')
    const reopened = meta({
      NUPHOS_RUNTIME_SKILLS_URL: 'https://bundle',
      NUPHOS_RUNTIME_SKILLS_TOKEN: 'p.none.10.sig',
    })

    await synced(reopened, run)
    assert.deepEqual(await readdir(skills), [])
  })
  delete globalThis.nuphosRefreshSkills
})

test('a reopened session never starts on another member’s personal skills', async () => {
  // The fetch answers late and installs nothing: what the session starts on was on disk.
  await withFakeScript('sleep 1', async ({ script, directory }) => {
    const claude = join(directory, 'personal-skills/.claude')
    const credentialsDir = join(directory, 'credentials')
    const leave = async (who) => {
      await mkdir(join(claude, 'skills', who), { recursive: true })
      await writeFile(join(claude, '.skills-revision'), who)
      await writeFile(join(claude, '.skills-holder'), who)
    }
    const open = async (who) => {
      await writeFile(join(credentialsDir, 'NUPHOS_RUNTIME_SKILLS_TOKEN'), `p.${who}.1.sig\n`)
      const opened = meta({
        NUPHOS_RUNTIME_SKILLS_URL: 'https://bundle',
        NUPHOS_RUNTIME_SKILLS_TOKEN: `p.${who}.1.sig`,
      })
      const { synced: fetch } = await nuphosSyncRuntimeSkills(opened, {
        script,
        sessionHome: directory,
        credentialsDir,
      })
      const onDisk = await readdir(join(claude, 'skills'))

      await fetch
      delete globalThis.nuphosRefreshSkills

      return onDisk
    }

    await mkdir(credentialsDir)
    await leave('owner')
    assert.deepEqual(await open('guest'), [])
    // The member whose skills they are keeps them.
    await leave('owner')
    assert.deepEqual(await open('owner'), ['owner'])
  })
})

test('both adapters re-sync skills before a prompt', () => {
  for (const signature of ['params', 'params, signal']) {
    const patched = patchSkillsRefresh(`class A {\n    async prompt(${signature}) {\n    }\n}`)

    assert.match(
      patched,
      /async prompt\(params(, signal)?\) \{\n\s+await globalThis\.nuphosRefreshSkills\?\.\(this, params\);/u,
    )
  }
  assert.throws(() => patchSkillsRefresh('class A {}'), /exactly one/u)
})

test('a prompt re-syncs the team skills, so a live session gets a skill added after it opened', async () => {
  // Each run records whether it was the team sync or a personal one.
  const body =
    '[ -n "$NUPHOS_RUNTIME_PERSONAL_SKILLS_DIR" ] && k=personal || k=team; echo $k >> "$NUPHOS_TEST_RECORD"'

  for (const provider of ['codex', 'claudeCode'])
    await withFakeScript(body, async ({ record, script, directory }) => {
      const params = meta(
        {
          NUPHOS_RUNTIME_SKILLS_URL: 'https://bundle',
          NUPHOS_RUNTIME_SKILLS_TOKEN: 'p.owner.1.sig',
        },
        provider,
      )
      const run = { script, env: { NUPHOS_TEST_RECORD: record } }

      if (provider === 'claudeCode') run.sessionHome = directory
      await synced(params, run)
      const opened = (await readFile(record, 'utf8')).split('\n').filter((k) => k === 'team').length

      await globalThis.nuphosRefreshSkills(undefined, { sessionId: 's1' })
      const after = (await readFile(record, 'utf8')).split('\n').filter((k) => k === 'team').length

      assert.equal(after, opened + 1, `${provider}: one team sync per prompt`)
      delete globalThis.nuphosRefreshSkills
    })
})

test('the Codex session shape is read too', async () => {
  await withFakeScript('printenv > "$NUPHOS_TEST_RECORD"', async ({ record, script }) => {
    assert.equal(
      await synced(
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
    assert.equal(await synced(carrying, { script }), false)
  })
  // The script allows itself two minutes; session/new must not wait that long. The
  // fetch is a child of the script, so the whole group has to go.
  await withFakeScript('sleep 120 & wait', async ({ script }) => {
    const started = Date.now()

    assert.equal(await synced(carrying, { script, timeoutMs: 300 }), false)
    assert.ok(Date.now() - started < 10_000)
  })
  // A missing script is the ordinary case on an image that ships no sync at all.
  assert.equal(await synced(carrying, { script: '/nonexistent/nuphos-sync-skills' }), false)
})

test('a session on an older team bundle starts with the newer one', async () => {
  await withInstalledBundle(async (workspace) => {
    const body = [
      'sleep 0.3',
      'printf %s rev-2 > "$NUPHOS_RUNTIME_WORKSPACE/.claude/.skills-revision"',
      'printf %s "# Two" > "$NUPHOS_RUNTIME_WORKSPACE/.claude/skills/kept/SKILL.md"',
    ].join('\n')

    await withFakeScript(body, async ({ script }) => {
      // Not `.synced`: this is the moment the agent starts and reads its skills, once.
      await nuphosSyncRuntimeSkills(bundleSession, {
        script,
        env: { NUPHOS_RUNTIME_WORKSPACE: workspace },
      })
      assert.equal(await readFile(join(workspace, '.claude/.skills-revision'), 'utf8'), 'rev-2')
      assert.equal(await readFile(join(workspace, '.claude/skills/kept/SKILL.md'), 'utf8'), '# Two')
    })
  })
})

test('each session offers the team skills, and only those, as a plugin of its own', async () => {
  await withInstalledBundle(async (workspace) => {
    await withFakeScript('exit 0', async ({ script, directory }) => {
      const plugins = async () => {
        const params = structuredClone(bundleSession)

        await nuphosSyncRuntimeSkills(params, {
          script,
          sessionHome: directory,
          env: { NUPHOS_RUNTIME_WORKSPACE: workspace },
        })
        delete globalThis.nuphosRefreshSkills

        return params._meta.claudeCode.options.plugins
      }
      const first = await plugins()

      // Not the personal skills: a plugin skill's content outlives its files for the
      // rest of the session, and so a teammate's turn in a shared conversation.
      assert.deepEqual(
        first.map((plugin) => [plugin.type, plugin.path.split('/').at(-1)]),
        [['local', 'team']],
      )
      for (const plugin of first) {
        const name = plugin.path.split('/').at(-1)

        assert.deepEqual(
          JSON.parse(await readFile(join(plugin.path, '.claude-plugin/plugin.json'), 'utf8')),
          { name },
        )
        // Nothing but the manifest and the skills: no hooks or MCP servers can ride along.
        assert.deepEqual((await readdir(plugin.path)).sort(), ['.claude-plugin', 'skills'])
        // Outside what the conversation writes to.
        assert.ok(!plugin.path.startsWith(workspace) && !plugin.path.startsWith(directory))
      }
      assert.equal(await readFile(join(first[0].path, 'skills/kept/SKILL.md'), 'utf8'), '# One')
      // The next session gets wrappers of its own.
      assert.notEqual((await plugins())[0].path, first[0].path)
    })
  })
})

test('a skill the backend names as hidden is left out of the plugin, not off the disk', async () => {
  await withInstalledBundle(async (workspace) => {
    await withFakeScript('exit 0', async ({ script, directory }) => {
      const params = structuredClone(bundleSession)

      params._meta.claudeCode.options.env.NUPHOS_HIDDEN_SKILLS = 'aws,kept'
      await nuphosSyncRuntimeSkills(params, {
        script,
        sessionHome: directory,
        env: { NUPHOS_RUNTIME_WORKSPACE: workspace },
      })
      delete globalThis.nuphosRefreshSkills
      const [team] = params._meta.claudeCode.options.plugins

      assert.deepEqual(await readdir(join(team.path, 'skills')), [])
      assert.equal(await readFile(join(workspace, '.claude/skills/kept/SKILL.md'), 'utf8'), '# One')
    })
  })
})

test('a skill added after the sync is fetched over, and never offered', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'nuphos-workspace-'))
  const claude = join(workspace, '.claude')
  // The backend's revision: a hash of the bundle's files.
  const hash = createHash('sha256')

  hash.update(`deploy/SKILL.md\0${Buffer.from('# Deploy').toString('base64')}\0`)
  await mkdir(join(claude, 'skills/deploy'), { recursive: true })
  await writeFile(join(claude, 'skills/deploy/SKILL.md'), '# Deploy')
  const revision = hash.digest('hex')

  await writeFile(join(claude, '.skills-revision'), revision)
  // The backend is unreachable; the script notes whether it had a revision to offer.
  const body = [
    'if [ -z "$NUPHOS_RUNTIME_PERSONAL_SKILLS_DIR" ]; then',
    '  [ -e "$NUPHOS_RUNTIME_WORKSPACE/.claude/.skills-revision" ] && echo revision >> "$NUPHOS_TEST_RECORD" || echo none >> "$NUPHOS_TEST_RECORD"',
    'fi',
    'exit 1',
  ].join('\n')

  try {
    await withFakeScript(body, async ({ script, directory, record }) => {
      const open = async () => {
        const params = structuredClone(bundleSession)

        await nuphosSyncRuntimeSkills(params, {
          script,
          sessionHome: directory,
          env: { NUPHOS_RUNTIME_WORKSPACE: workspace, NUPHOS_TEST_RECORD: record },
        })
        delete globalThis.nuphosRefreshSkills

        return params._meta.claudeCode.options.plugins.map((plugin) =>
          plugin.path.split('/').at(-1),
        )
      }

      // Untouched, the tree is confirmed by its revision, and offered.
      assert.deepEqual(await open(), ['team'])
      // Changed, it is fetched without the revision, and left out while it cannot be:
      // a skill, a hooks file or an MCP server added to it all change what it hashes to.
      for (const [planted, content] of [
        ['planted/SKILL.md', '---\nname: planted\nhooks:\n  PreToolUse: []\n---\n'],
        ['deploy/hooks/hooks.json', '{"hooks":{"SessionStart":[]}}'],
        ['.mcp.json', '{"mcpServers":{"planted":{"command":"sh"}}}'],
      ]) {
        const target = join(claude, 'skills', planted)

        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content)
        await rm(record, { force: true })
        assert.deepEqual(await open(), [], planted)
        assert.equal((await readFile(record, 'utf8')).trim(), 'none', planted)
        // Its revision is gone, so only a full fetch makes it offered again.
        await rm(target)
        await writeFile(join(claude, '.skills-revision'), revision)
      }
    })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('a wrapper goes with its session’s process, or with the next session after a crash', async () => {
  // A process that has ended, and one that is still running (this one's parent).
  const ended = spawnSync(process.execPath, ['-e', '']).pid
  const stale = await mkdtemp(join(tmpdir(), `nuphos-skill-plugins-${String(ended)}-`))
  const live = await mkdtemp(join(tmpdir(), `nuphos-skill-plugins-${String(process.ppid)}-`))
  const gone = (target) =>
    readdir(target).then(
      () => false,
      () => true,
    )

  await withInstalledBundle(async (workspace) => {
    await withFakeScript('exit 0', async ({ script, directory }) => {
      await nuphosSyncRuntimeSkills(structuredClone(bundleSession), {
        script,
        sessionHome: directory,
        env: { NUPHOS_RUNTIME_WORKSPACE: workspace },
      })
      delete globalThis.nuphosRefreshSkills
      assert.ok(await gone(stale))
      assert.ok(!(await gone(live)))
      await rm(live, { recursive: true })

      // A session in a process of its own: its wrapper is gone once the process exits.
      const child = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const { nuphosSyncRuntimeSkills } = await import(${JSON.stringify(new URL('../image/runtime-defaults.mjs', import.meta.url).href)})
          const opened = ${JSON.stringify(bundleSession)}
          await nuphosSyncRuntimeSkills(opened, { script: ${JSON.stringify(script)}, sessionHome: ${JSON.stringify(directory)}, env: { NUPHOS_RUNTIME_WORKSPACE: ${JSON.stringify(workspace)} } })
          console.log(opened._meta.claudeCode.options.plugins[0].path)
          process.exit(0)`,
        ],
        { encoding: 'utf8' },
      )
      const wrapper = dirname(child.stdout.trim())

      assert.match(wrapper, /nuphos-skill-plugins-/u)
      assert.ok(await gone(wrapper))
    })
  })
})

test('the first session in a workspace starts with the team skills on disk', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'nuphos-workspace-'))
  const body = [
    'sleep 0.3',
    'mkdir -p "$NUPHOS_RUNTIME_WORKSPACE/.claude/skills/deploy"',
    'printf %s "# Deploy" > "$NUPHOS_RUNTIME_WORKSPACE/.claude/skills/deploy/SKILL.md"',
  ].join('\n')

  try {
    await withFakeScript(body, async ({ script }) => {
      // Not `.synced`: this is the moment the agent starts and reads its skills, once.
      await nuphosSyncRuntimeSkills(bundleSession, {
        script,
        env: { NUPHOS_RUNTIME_WORKSPACE: workspace },
      })
      assert.equal(
        await readFile(join(workspace, '.claude/skills/deploy/SKILL.md'), 'utf8'),
        '# Deploy',
      )
    })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('a failed fetch nobody waits for is still logged', async (t) => {
  await withFakeScript('exit 7', async ({ script }) => {
    const written = t.mock.method(process.stderr, 'write', () => true)

    try {
      assert.equal(await synced(bundleSession, { script }), false)
      assert.ok(
        written.mock.calls.some((call) => /skills sync failed/u.test(String(call.arguments[0]))),
      )
    } finally {
      written.mock.restore()
    }
  })
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

    // The fetches run behind the sessions, so they are waited for here.
    const fetched = async () =>
      (await readFile(record, 'utf8').catch(() => '')).split('\n').filter(Boolean)

    await waitFor(async () => (await fetched()).length === 3)
    assert.deepEqual((await fetched()).toSorted(), [
      'https://load',
      'https://new',
      'https://resume',
    ])
  })
})
