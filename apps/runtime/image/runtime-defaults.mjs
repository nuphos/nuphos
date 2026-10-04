// Pull the team's skill bundle into the workspace before the session is handed back.
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
    params?._meta?.claudeCode?.options?.env ?? params?._meta?.['ai.nuphos/codex']?.env ?? {}
  const url = env.NUPHOS_RUNTIME_SKILLS_URL
  const token = env.NUPHOS_RUNTIME_SKILLS_TOKEN

  // Both or nothing: a managed pod carries neither and must not be touched.
  if (typeof url !== 'string' || typeof token !== 'string' || !url || !token) return false
  const { spawn } = await import('node:child_process')

  return new Promise((resolve) => {
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
    const timer = setTimeout(stop, (run?.timeoutMs ?? 20_000) | 0)

    child.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
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
