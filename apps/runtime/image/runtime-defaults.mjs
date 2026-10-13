// Pull the team's skill bundle into the workspace before the session is handed back,
// and the sender's personal skills into the conversation's own home.
//
// A provisioned pod gets its skills pushed by the reconciler, which nothing can do for
// a container Nuphos never created. The backend instead delivers a one-conversation URL
// and token in the session's own environment, so the runtime fetches its own bundle.
//
// Never fatal. A runtime with no bundle, an unreachable backend or a wedged fetch must
// still hold a conversation — skills are an enrichment, not a precondition. The script
// allows itself two minutes, which is far longer than a session/new may block, so the
// timeout here is the real budget and the kill is what enforces it.
export async function nuphosSyncRuntimeSkills(params, run) {
  const env =
    params?._meta?.claudeCode?.options?.env ??
    params?._meta?.['ai.nuphos/codex']?.env ??
    params?._meta?.['ai.nuphos/session']?.env ??
    {}
  const url = env.NUPHOS_RUNTIME_SKILLS_URL
  const token = env.NUPHOS_RUNTIME_SKILLS_TOKEN

  // Both or nothing: a managed pod carries neither and must not be touched.
  if (typeof url !== 'string' || typeof token !== 'string' || !url || !token) return false
  const { spawn } = await import('node:child_process')
  const sync = (extra, timeoutMs = run?.timeoutMs ?? 20_000) =>
    new Promise((resolve) => {
      const child = spawn(run?.script ?? '/usr/local/bin/nuphos-sync-skills', {
        // The bundle credential is the only thing this child needs from us; it must not
        // inherit the agent's account or the runtime's transport keys.
        // Deliberately not NUPHOS_RUNTIME_WORKSPACE. The script mkdirs under it,
        // replaces files in it and recursively removes trees beneath it, so a path
        // chosen per session would be a write primitive pointed wherever the caller
        // liked. The image's own workspace is the script's default and the only one
        // a session can reach; an operator relocating it does so in the container's
        // environment, which this child does not inherit.
        env: {
          PATH: '/usr/local/bin:/usr/bin:/bin',
          HOME: '/home/node',
          NUPHOS_RUNTIME_SKILLS_URL: url,
          NUPHOS_RUNTIME_SKILLS_TOKEN: token,
          ...extra,
          ...(run?.env ?? {}),
        },
        stdio: ['ignore', 'ignore', 'ignore'],
        detached: process.platform !== 'win32',
      })
      const stop = () => {
        if (!child.pid) return
        try {
          // curl and jq are children of the script, so only the group going away
          // actually ends a fetch that has stopped making progress.
          if (process.platform === 'win32') child.kill('SIGKILL')
          else process.kill(-child.pid, 'SIGKILL')
        } catch {
          /* Already gone. */
        }
      }
      const timer = setTimeout(stop, timeoutMs | 0)

      child.once('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        resolve(code === 0)
      })
    })
  // The sender's personal skills go to this conversation's own home and are offered to
  // Claude Code as an additional directory, so no other conversation on the runtime
  // loads them. The home is derived from the conversation id, never taken from the
  // session. Only the Claude adapter carries `nuphosSessionHomeEnv` and the option.
  const options = params?._meta?.claudeCode?.options
  const home = !options
    ? undefined
    : (run?.sessionHome ??
      (typeof nuphosSessionHomeEnv === 'function' ? nuphosSessionHomeEnv(env).HOME : undefined))

  if (!home) return sync()
  const path = await import('node:path')
  const fs = await import('node:fs/promises')
  const personal = path.join(home, 'personal-skills')
  const skills = path.join(personal, '.claude', 'skills')
  // The sender can change between turns of a live session. OpenAB keeps the current
  // sender's credential in its per-session directory, so this runs again before every
  // prompt (see patchRuntimeDefaults) and leaves that sender's skills, or none.
  const revision = () =>
    fs.readFile(path.join(personal, '.claude', '.skills-revision'), 'utf8').catch(() => '')
  const syncPersonal = async (timeoutMs) => {
    const before = await revision()
    const credentials = run?.credentialsDir ?? process.env.OPENAB_CREDENTIALS_DIR
    const current = !credentials
      ? ''
      : await fs.readFile(path.join(credentials, 'NUPHOS_RUNTIME_SKILLS_TOKEN'), 'utf8').then(
          (value) => value.trim(),
          () => '',
        )
    const mine = await sync(
      {
        NUPHOS_RUNTIME_PERSONAL_SKILLS_DIR: personal,
        ...(current && !/[\u0000-\u001f"\\]/u.test(current)
          ? { NUPHOS_RUNTIME_SKILLS_TOKEN: current }
          : {}),
      },
      timeoutMs,
    )

    // A sync that failed must not leave the previous sender's skills in place. The
    // directory itself stays: the running session watches it.
    if (!mine) {
      for (const entry of await fs.readdir(skills).catch(() => []))
        await fs.rm(path.join(skills, entry), { recursive: true, force: true }).catch(() => {})
      await fs
        .rm(path.join(personal, '.claude', '.skills-revision'), { force: true })
        .catch(() => {})
    }

    return (await revision()) !== before
  }

  // A running Claude Code session reads its skills when it starts, and its file watcher
  // can lag a change by half a minute once the session is idle. So when the tree
  // changed, the session is rebuilt the way the adapter itself rebuilds one whose
  // parameters changed: torn down and resumed, keeping the transcript and the settings
  // the session had.
  globalThis.nuphosRefreshPersonalSkills = async (agent, prompt) => {
    const changed = await syncPersonal(5_000).catch(() => false)
    const id = prompt?.sessionId
    const live = agent?.sessions?.[id]

    if (!changed || !live) return
    const kept = (live.configOptions ?? []).map((option) => [option.id, option.currentValue])

    await agent.teardownSession(id)
    const rebuilt = await agent.createSession(
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        additionalDirectories: params.additionalDirectories,
        _meta: params._meta,
      },
      { resume: id },
    )

    for (const [configId, value] of kept) {
      const now = rebuilt.configOptions?.find((option) => option.id === configId)

      if (now && now.currentValue !== value)
        await agent.setSessionConfigOption({ sessionId: id, configId, value }).catch(() => {})
    }
  }
  const [team] = await Promise.all([sync(), syncPersonal()])

  // Present even when empty, so a skill synced for a later turn is picked up.
  await fs.mkdir(skills, { recursive: true })
  options.additionalDirectories = [
    ...(options.additionalDirectories ?? []).filter((dir) => dir !== personal),
    personal,
  ]

  return team
}

// Run inside the native adapter after session/new has discovered its controls,
// before OpenAB receives the session or sends the first prompt. Never run on load.
export async function nuphosApplyRuntimeDefaults(agent, params, response) {
  const defaults = params._meta?.['ai.nuphos/runtimeDefaults']
  if (!defaults || Object.keys(defaults).length === 0) return response
  let options = response.configOptions
  const kindOf = (option) => {
    if (option.category === 'model' || option.id === 'model') return 'model'
    if (
      option.category === 'thought_level' ||
      ['reasoning_effort', 'effort', 'thinking'].includes(option.id)
    )
      return 'effort'
    if (['fast-mode', 'fast_mode', 'fast'].includes(option.id)) return 'fast'
  }
  for (const kind of ['model', 'fast', 'effort']) {
    const value = defaults[kind]
    if (value === undefined) continue
    const option = options?.find((entry) => kindOf(entry) === kind)
    if (!option?.options?.some((choice) => choice.value === value)) {
      throw new Error(
        `The default ${kind} is not supported. Update this runtime in Settings → Agent, then start a new conversation.`,
      )
    }
    if (option.currentValue === value) continue
    const updated = await agent.setSessionConfigOption({
      sessionId: response.sessionId,
      configId: option.id,
      value,
    })
    options = updated.configOptions
    if (!options?.some((entry) => entry.id === option.id && entry.currentValue === value)) {
      throw new Error(
        `The runtime did not accept the default ${kind}. Update Settings → Agent, then start a new conversation.`,
      )
    }
  }
  const model = options?.find((entry) => kindOf(entry) === 'model')
  return {
    ...response,
    configOptions: options,
    ...(response.models && model
      ? { models: { ...response.models, currentModelId: model.currentValue } }
      : {}),
  }
}

export function patchRuntimeDefaults(source) {
  const anchor = 'async newSession(params) {'
  // Skills live in the container, so a session reopened after a restart needs them again.
  const reopenAnchors = ['async loadSession(params) {', 'async resumeSession(params) {']
  for (const handler of [anchor, ...reopenAnchors])
    if (source.split(handler).length !== 2)
      throw new Error(`Expected exactly one native ACP \`${handler}\` handler.`)
  const shebang = source.match(/^#![^\n]*\n/)?.[0] ?? ''
  let body = source.slice(shebang.length).replace(
    anchor,
    `async newSession(params) {
    await nuphosSyncRuntimeSkills(params);
    return nuphosApplyRuntimeDefaults(this, params, await this.nuphosNewSession(params));
  }
  async nuphosNewSession(params) {`,
  )
  for (const handler of reopenAnchors)
    body = body.replace(handler, `${handler}\n        await nuphosSyncRuntimeSkills(params);`)
  return `${shebang}${nuphosSyncRuntimeSkills.toString()}\n${nuphosApplyRuntimeDefaults.toString()}\n${body}`
}

// Claude only. The sender of a turn may differ from the last one's, so their personal
// skills are re-synced before every prompt of a live session, which is rebuilt when
// they changed. Strict on purpose: losing
// this silently would leave one member's skills in place for the next.
export function patchPersonalSkillsRefresh(source) {
  const anchor = 'async prompt(params) {'

  if (source.split(anchor).length !== 2)
    throw new Error(`Expected exactly one native ACP \`${anchor}\` handler.`)

  return source.replace(
    anchor,
    `${anchor}\n        await globalThis.nuphosRefreshPersonalSkills?.(this, params);`,
  )
}
