// Serialized into the adapter with `.toString()`, so it must stay self-contained:
// no top-level imports and no references outside its own body.
export async function nuphosLocalSyncSkills(params, options = {}) {
  const env =
    params?._meta?.claudeCode?.options?.env ??
    params?._meta?.['ai.nuphos/codex']?.env ??
    params?._meta?.['ai.nuphos/session']?.env ??
    {}
  const url = env.NUPHOS_RUNTIME_SKILLS_URL
  const token = env.NUPHOS_RUNTIME_SKILLS_TOKEN
  const workspace = options.workspace ?? process.env.NUPHOS_RUNTIME_WORKSPACE

  if (typeof url !== 'string' || typeof token !== 'string' || !url || !token || !workspace)
    return false
  if (!/^https?:\/\//u.test(url) || /[\u0000-\u001f"\\]/u.test(url + token)) return false
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

  if (!personal) return install(path.join(workspace, '.claude'), url, true)
  const personalClaude = path.join(personal, '.claude')
  const personalSkills = path.join(personalClaude, 'skills')
  // Whose personal skills, if anyone's, can change between the turns of a live session.
  // OpenAB keeps the current turn's credential in its per-session directory, so this
  // runs again before every prompt and leaves the skills that credential allows, or
  // none. It reports whether the skills on disk changed.
  const revisionFile = path.join(personalClaude, '.skills-revision')
  const empty = async () => {
    for (const entry of await fs.readdir(personalSkills).catch(() => []))
      await fs
        .rm(path.join(personalSkills, entry), { recursive: true, force: true })
        .catch(() => {})
    await fs.rm(revisionFile, { force: true }).catch(() => {})
  }
  // No personal skills is one state, whoever the credential names.
  const installed = async () =>
    (await fs.readdir(personalSkills).catch(() => [])).length === 0
      ? ''
      : await fs.readFile(revisionFile, 'utf8').catch(() => '')
  // The part of the credential that says whose it is; the rest changes on every mint.
  const holder = (credential) => credential.split('.')[1] ?? ''
  // Unknown until a sync here succeeds: a reopened session finds whatever an earlier
  // process left in this home, so the first failed sync empties it.
  let syncedFor
  const syncPersonal = async (timeoutMs, atPrompt) => {
    const before = await installed()
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
    const credential = usable ? refreshed : atPrompt && credentials ? '' : token

    if (!credential) {
      await empty()
      syncedFor = ''
    } else if (
      await install(personalClaude, `${url}?scope=personal`, false, credential, timeoutMs)
    ) {
      syncedFor = holder(credential)
    } else if (holder(credential) !== syncedFor) {
      // A failed sync must not leave another member's skills in place. For the same
      // member it changes nothing: what is installed stays.
      await empty()
      syncedFor = holder(credential)
    }

    return (await installed()) !== before
  }

  // A running Claude Code session reads its skills when it starts, and its file watcher
  // can lag a change by half a minute once the session is idle. So when the skills on
  // disk changed, the session is rebuilt the way the adapter itself rebuilds one whose
  // parameters changed: torn down and resumed, keeping the transcript and the settings
  // the session had. Anything short of that leaves the session as it is.
  globalThis.nuphosRefreshPersonalSkills = async (agent, prompt) => {
    const changed = await syncPersonal(5_000, true).catch(() => false)
    const id = prompt?.sessionId
    const live = agent?.sessions?.[id]

    if (!changed || !live) return
    const kept = (live.configOptions ?? []).map((option) => [option.id, option.currentValue])
    const resume = () =>
      agent.createSession(
        {
          cwd: params.cwd,
          mcpServers: params.mcpServers ?? [],
          additionalDirectories: params.additionalDirectories,
          _meta: params._meta,
        },
        { resume: id },
      )

    await agent.teardownSession(id)
    // Past the teardown there is no session to fall back to, so try twice before
    // letting the turn fail.
    const rebuilt = await resume().catch(resume)

    for (const [configId, value] of kept) {
      const now = rebuilt.configOptions?.find((option) => option.id === configId)

      if (now && now.currentValue !== value)
        await agent.setSessionConfigOption({ sessionId: id, configId, value }).catch(() => {})
    }
  }
  const [team] = await Promise.all([
    install(path.join(workspace, '.claude'), url, true),
    syncPersonal(),
  ])

  // Present even when empty, so a skill synced for a later turn is picked up.
  await fs.mkdir(personalSkills, { recursive: true })
  claudeOptions.additionalDirectories = [
    ...(claudeOptions.additionalDirectories ?? []).filter((dir) => dir !== personal),
    personal,
  ]

  return team
}
