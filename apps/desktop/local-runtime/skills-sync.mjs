// Serialized into the adapter with `.toString()`, so it must stay self-contained:
// no top-level imports and no references outside its own body.
//
// A session waits for both fetches, bounded by their timeout, so its first turn already
// has them. Later turns re-sync before each prompt, and the running agent reads the
// change from disk. A runtime that already holds the current bundle is
// answered 304 without a file being read (#1923), so the wait is one round trip.
export async function nuphosLocalSyncSkills(params, options = {}) {
  const env =
    params?._meta?.claudeCode?.options?.env ??
    params?._meta?.['ai.nuphos/codex']?.env ??
    params?._meta?.['ai.nuphos/session']?.env ??
    {}
  const url = env.NUPHOS_RUNTIME_SKILLS_URL
  const token = env.NUPHOS_RUNTIME_SKILLS_TOKEN
  const workspace = options.workspace ?? process.env.NUPHOS_RUNTIME_WORKSPACE

  const none = { synced: Promise.resolve(false) }

  if (typeof url !== 'string' || typeof token !== 'string' || !url || !token || !workspace)
    return none
  if (!/^https?:\/\//u.test(url) || /[\u0000-\u001f"\\]/u.test(url + token)) return none
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const { createHash, randomUUID } = await import('node:crypto')
  const os = await import('node:os')
  // The owner's personal skills go to this conversation's own home and are offered to
  // Claude Code as an additional directory, so no other conversation loads them.
  const claudeOptions = params?._meta?.claudeCode?.options
  const sessionHome = !claudeOptions
    ? undefined
    : (options.sessionHome ??
      (typeof nuphosSessionHomeEnv === 'function' ? nuphosSessionHomeEnv(env).HOME : undefined))
  const personal = sessionHome && path.join(sessionHome, 'personal-skills')
  const install = async (claudeDir, bundleUrl, shared, bearer = token, timeoutMs) => {
    const skillsDir = path.join(claudeDir, 'skills')
    const revisionFile = path.join(claudeDir, '.skills-revision')
    const lockDir = path.join(claudeDir, '.skills-sync.lock')
    const readRevision = () =>
      fs.readFile(revisionFile, 'utf8').then(
        (value) => value.trim(),
        () => '',
      )
    const exists = (target) =>
      fs.lstat(target).then(
        () => true,
        () => false,
      )
    const safeRevision = /^[A-Za-z0-9._-]{1,128}$/u

    try {
      await fs.mkdir(claudeDir, { recursive: true })
      const installed = await readRevision()
      const headers = { authorization: `Bearer ${bearer}` }

      if ((await exists(skillsDir)) && safeRevision.test(installed))
        headers['if-none-match'] = `"${installed}"`
      const response = await fetch(bundleUrl, {
        headers,
        signal: AbortSignal.timeout(timeoutMs ?? options.timeoutMs ?? 20_000),
      })

      if (response.status === 304) return true
      if (!response.ok) return false
      const bundle = await response.json()

      if (!safeRevision.test(bundle?.revision ?? '') || !Array.isArray(bundle.files)) return false
      // A backend that predates personal skills answers with the team bundle.
      if (!shared && bundle.scope !== 'personal') return true
      const staging = path.join(claudeDir, `.skills-sync.${randomUUID()}`)

      await fs.mkdir(staging, { recursive: true })
      try {
        for (const file of bundle.files) {
          const relative = file?.path

          if (
            typeof relative !== 'string' ||
            !relative ||
            relative.startsWith('/') ||
            relative.includes('..') ||
            relative.includes('//') ||
            relative.includes('\\')
          )
            throw new Error(`unsafe runtime skill path: ${String(relative)}`)
          const destination = path.join(staging, relative)

          await fs.mkdir(path.dirname(destination), { recursive: true })
          await fs.writeFile(destination, Buffer.from(String(file.contentBase64 ?? ''), 'base64'), {
            mode: file.executable === true ? 0o755 : 0o644,
          })
        }

        const deadline = Date.now() + 30_000

        for (;;) {
          try {
            await fs.mkdir(lockDir)
            break
          } catch {
            const stale = await fs.stat(lockDir).then(
              (stat) => Date.now() - stat.mtimeMs > 120_000,
              () => false,
            )

            if (stale) await fs.rm(lockDir, { recursive: true, force: true })
            else if (Date.now() > deadline) return false
            else await new Promise((resolve) => setTimeout(resolve, 200))
          }
        }
        try {
          if ((await exists(skillsDir)) && (await readRevision()) === bundle.revision) return true
          // Personal skills are replaced in place: a running Claude Code session watches
          // the directory it resolved at start and never follows a swapped symlink.
          if (!shared) {
            if ((await fs.lstat(skillsDir).catch(() => null))?.isSymbolicLink())
              await fs.rm(skillsDir, { force: true })
            await fs.mkdir(skillsDir, { recursive: true })
            // The marker goes first: a run cut off halfway must not leave a partial
            // tree that later runs take for the complete one.
            await fs.rm(revisionFile, { force: true })
            for (const entry of await fs.readdir(skillsDir))
              await fs.rm(path.join(skillsDir, entry), { recursive: true, force: true })
            await fs.cp(staging, skillsDir, { recursive: true })
            await fs.writeFile(`${revisionFile}.incoming`, bundle.revision)
            await fs.rename(`${revisionFile}.incoming`, revisionFile)

            return true
          }
          const tree = path.join(claudeDir, `skills.${bundle.revision}.${randomUUID().slice(0, 8)}`)

          await fs.rename(staging, tree)
          const current = await fs.lstat(skillsDir).catch(() => null)

          if (process.platform === 'win32' || (current && !current.isSymbolicLink())) {
            await fs.rm(skillsDir, { recursive: true, force: true })
          }
          if (process.platform === 'win32') await fs.rename(tree, skillsDir)
          else {
            const link = path.join(claudeDir, `.skills-link.${randomUUID()}`)

            await fs.symlink(path.basename(tree), link)
            await fs.rename(link, skillsDir)
          }
          if (process.platform !== 'win32') {
            const agentsDir = path.join(workspace, '.agents')

            await fs.mkdir(agentsDir, { recursive: true })
            if (!(await exists(path.join(agentsDir, 'skills'))))
              await fs.symlink(path.join('..', '.claude', 'skills'), path.join(agentsDir, 'skills'))
          }
          const settings = path.join(skillsDir, '_runtime', 'settings.json')

          // Only the team bundle reaches this point, so a personal skill cannot
          // become agent settings.
          if (await exists(settings)) {
            const incoming = path.join(claudeDir, '.settings.json.incoming')

            await fs.copyFile(settings, incoming)
            await fs.rename(incoming, path.join(claudeDir, 'settings.json'))
          }
          await fs.writeFile(`${revisionFile}.incoming`, bundle.revision)
          await fs.rename(`${revisionFile}.incoming`, revisionFile)
          for (const entry of await fs.readdir(claudeDir)) {
            if (entry.startsWith('skills.') && entry !== path.basename(tree))
              await fs.rm(path.join(claudeDir, entry), { recursive: true, force: true })
          }
        } finally {
          await fs.rm(lockDir, { recursive: true, force: true })
        }

        return true
      } finally {
        await fs.rm(staging, { recursive: true, force: true })
      }
    } catch {
      return false
    }
  }

  const teamClaude = path.join(workspace, '.claude')

  // A live session reads skill files as they change on disk, so a prompt re-syncs the
  // team bundle too (#3365): one round trip, answered 304 when nothing changed.
  const syncTeam = (timeoutMs) => install(teamClaude, url, true, token, timeoutMs)

  if (!personal) {
    globalThis.nuphosRefreshSkills = () => syncTeam(5_000).catch(() => {})

    return { synced: Promise.resolve(await syncTeam()) }
  }
  // Whether a tree holds exactly the files of the revision recorded beside it. The
  // revision is the backend's hash of the bundle's files (`revisionOf`), so a skill
  // anyone added or changed after the sync, in a directory the agent can write to,
  // fails it. A skill can carry hooks and allowed tools, so only such a tree is offered.
  const intact = async (claudeDir) => {
    const skillsDir = path.join(claudeDir, 'skills')
    const files = []
    const walk = async (dir, prefix) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const relative = prefix + entry.name

        if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${relative}/`)
        else if (entry.isFile()) files.push(relative)
        else throw new Error(`Not a file: ${relative}`)
      }
    }

    try {
      await walk(skillsDir, '')
      if (!files.length) return true
      const revision = await fs.readFile(path.join(claudeDir, '.skills-revision'), 'utf8')
      const hash = createHash('sha256')

      for (const relative of files.sort()) {
        hash.update(`${relative}\0`)
        hash.update(`${(await fs.readFile(path.join(skillsDir, relative))).toString('base64')}\0`)
      }

      return hash.digest('hex') === revision.trim()
    } catch (error) {
      return error?.code === 'ENOENT' && !files.length
    }
  }
  const personalClaude = path.join(personal, '.claude')
  const personalSkills = path.join(personalClaude, 'skills')
  // Whose personal skills, if anyone's, can change between the turns of a live session.
  // OpenAB keeps the current turn's credential in its per-session directory, so this
  // runs again before every prompt and leaves the skills that credential allows, or
  // none.
  const revisionFile = path.join(personalClaude, '.skills-revision')
  // Whose skills are on disk. Kept beside them rather than in this process, because a
  // reopened session finds whatever an earlier process left in this home.
  const holderFile = path.join(personalClaude, '.skills-holder')
  const empty = async () => {
    for (const entry of await fs.readdir(personalSkills).catch(() => []))
      await fs
        .rm(path.join(personalSkills, entry), { recursive: true, force: true })
        .catch(() => {})
    await fs.rm(revisionFile, { force: true }).catch(() => {})
    await fs.rm(holderFile, { force: true }).catch(() => {})
  }
  // The part of the credential that says whose it is; the rest changes on every mint.
  const holder = (credential) => credential.split('.')[1] ?? ''
  const owner = () => fs.readFile(holderFile, 'utf8').catch(() => '')
  const credentialFor = async (atPrompt) => {
    const credentials = options?.credentialsDir ?? process.env.OPENAB_CREDENTIALS_DIR
    const refreshed = !credentials
      ? ''
      : await fs.readFile(path.join(credentials, 'NUPHOS_RUNTIME_SKILLS_TOKEN'), 'utf8').then(
          (value) => value.trim(),
          () => '',
        )
    const usable = refreshed && !/[\u0000-\u001f"\\]/u.test(refreshed)

    // Opening a session may use the credential the session came with. A prompt may
    // not: without this turn's own credential, nobody's personal skills are installed.
    // (With no credentials directory at all there is no per-turn credential to prefer;
    // OpenAB sets it for every session it runs.)
    return usable ? refreshed : atPrompt && credentials ? '' : token
  }
  const syncPersonal = async (timeoutMs, atPrompt) => {
    const credential = await credentialFor(atPrompt)

    if (!credential) await empty()
    else if (await install(personalClaude, `${url}?scope=personal`, false, credential, timeoutMs))
      await fs.writeFile(holderFile, holder(credential))
    // A failed sync must not leave another member's skills in place. For the same
    // member it changes nothing: what is installed stays.
    else if (holder(credential) !== (await owner())) await empty()
  }

  // A prompt only syncs the skills on disk. The running session picks a change up
  // through its own file watcher (the personal tree is replaced in place for that), and
  // a new process reads it on start. Rebuilding the session here meant tearing it down
  // and resuming it, and a new conversation's first turn has nothing saved to resume:
  // the turn failed with -32002 and every later one with "Session not found". The
  // runtime image dropped the same rebuild in #2618.
  globalThis.nuphosRefreshSkills = () =>
    Promise.all([syncTeam(5_000), syncPersonal(5_000, true)]).catch(() => {})
  // A session reads its skills when it starts, and the fetch runs behind it. So skills
  // left here for anyone but the member opening it are cleared first; that is local.
  const opener = holder(await credentialFor(false))

  if (!opener || opener !== (await owner())) await empty()
  const checked = await intact(teamClaude)

  // A tree that fails the check is fetched in full, not confirmed by its revision.
  if (!checked) await fs.rm(path.join(teamClaude, '.skills-revision'), { force: true })
  const [synced] = await Promise.all([syncTeam(), syncPersonal().catch(() => false)])

  // Present even when empty, so a skill synced for a later turn is picked up.
  await fs.mkdir(personalSkills, { recursive: true })
  claudeOptions.additionalDirectories = [
    ...(claudeOptions.additionalDirectories ?? []).filter((dir) => dir !== personal),
    personal,
  ]
  // Claude Code runs on user settings only, and then registers no skill from the
  // working directory or from an additional one. A plugin loads whatever the setting
  // sources are, so the team's tree is offered as one, which names its skills
  // `team:<skill>`. A plugin can also carry hooks and MCP servers, so the wrapper holds
  // nothing but a manifest and a link to the skills, and each session gets a new one
  // outside the workspace and the conversation's home. Claude Code reads plugin skills
  // once, when the session starts, so a tree checked or fetched just now is what the
  // session gets, and one that is neither is left out.
  //
  // Personal skills are not offered this way. Claude Code keeps a plugin skill's
  // content from the start of the session, so in a shared conversation a teammate's
  // turn could still invoke the opener's personal skills after the refresh above
  // removed them from disk. They stay files in the additional directory, which the
  // refresh does keep to the turn's own member.
  // OpenAB runs one agent process per session, so a wrapper goes when its process
  // exits, and one whose process is gone without that (killed, crashed) is swept by
  // the next session to start.
  const hidden = new Set(String(env.NUPHOS_HIDDEN_SKILLS ?? '').split(','))
  const prefix = 'nuphos-skill-plugins-'

  for (const entry of await fs.readdir(os.tmpdir()).catch(() => [])) {
    const owner = Number(/^nuphos-skill-plugins-(\d+)-/u.exec(entry)?.[1])

    if (!owner || owner === process.pid) continue
    try {
      process.kill(owner, 0)
    } catch (error) {
      if (error?.code === 'ESRCH')
        await fs.rm(path.join(os.tmpdir(), entry), { recursive: true, force: true }).catch(() => {})
    }
  }
  const plugins = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}${process.pid}-`))
  const { rmSync } = await import('node:fs')

  process.once('exit', () => rmSync(plugins, { recursive: true, force: true }))
  const offered = checked || synced ? [['team', path.join(teamClaude, 'skills')]] : []

  for (const [name, skills] of offered) {
    await fs.mkdir(path.join(plugins, name, '.claude-plugin'), { recursive: true })
    await fs.writeFile(
      path.join(plugins, name, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name }),
    )
    // One link per skill, leaving out the provider skills the backend names as
    // unselected for this conversation (NUPHOS_HIDDEN_SKILLS).
    await fs.mkdir(path.join(plugins, name, 'skills'))
    for (const entry of await fs.readdir(skills, { withFileTypes: true }).catch(() => []))
      if (entry.isDirectory() && !hidden.has(entry.name))
        await fs.symlink(
          path.join(skills, entry.name),
          path.join(plugins, name, 'skills', entry.name),
          'junction',
        )
  }
  claudeOptions.plugins = [
    ...(claudeOptions.plugins ?? []).filter(
      (plugin) => !path.basename(path.dirname(plugin?.path ?? '')).startsWith(prefix),
    ),
    ...offered.map(([name]) => ({ type: 'local', path: path.join(plugins, name) })),
  ]

  return { synced: Promise.resolve(synced) }
}
