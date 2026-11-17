// Serialized into the adapter with `.toString()`, so it must stay self-contained:
// no top-level imports and no references outside its own body.
//
// A workspace that already has team skills never holds a session open on the network.
// It returns once the session's own directories are set up; the fetch runs on as
// `synced` and lands for the next session. A workspace with none waits for the team
// bundle: the agent reads `.claude/skills` once, when it starts, so skills that land a
// moment later would be missing from the whole conversation.
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
  const { randomUUID } = await import('node:crypto')
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
  const fresh = await fs.lstat(path.join(teamClaude, 'skills')).then(
    () => false,
    () => true,
  )
  const team = install(teamClaude, url, true)

  if (!personal) {
    if (fresh) await team

    return { synced: team }
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
  globalThis.nuphosRefreshPersonalSkills = () => syncPersonal(5_000, true).catch(() => {})
  // A session reads its skills when it starts, and the fetch runs behind it. So skills
  // left here for anyone but the member opening it are cleared first; that is local.
  const opener = holder(await credentialFor(false))

  if (!opener || opener !== (await owner())) await empty()
  const synced = Promise.all([team, syncPersonal().catch(() => false)]).then(([ok]) => ok)

  if (fresh) await team

  // Present even when empty, so a skill synced for a later turn is picked up.
  await fs.mkdir(personalSkills, { recursive: true })
  claudeOptions.additionalDirectories = [
    ...(claudeOptions.additionalDirectories ?? []).filter((dir) => dir !== personal),
    personal,
  ]

  return { synced }
}
