import { nuphosStreamReplyImages } from './reply-image-stream.mjs'
import { nuphosReplyImages, nuphosUploadReplyImages } from './reply-images.mjs'

// Pull the team's skill bundle into the workspace before the session is handed back,
// and the owner's personal skills into the conversation's own home.
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
  // The owner's personal skills go to this conversation's own home and are offered to
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
  // Whose personal skills, if anyone's, can change between the turns of a live session.
  // OpenAB keeps the current turn's credential in its per-session directory, so this
  // runs again before every prompt and leaves the skills that credential allows, or
  // none. It reports whether the skills on disk changed.
  const revisionFile = path.join(path.join(personal, '.claude'), '.skills-revision')
  const empty = async () => {
    for (const entry of await fs.readdir(skills).catch(() => []))
      await fs.rm(path.join(skills, entry), { recursive: true, force: true }).catch(() => {})
    await fs.rm(revisionFile, { force: true }).catch(() => {})
  }
  // No personal skills is one state, whoever the credential names.
  const installed = async () =>
    (await fs.readdir(skills).catch(() => [])).length === 0
      ? ''
      : await fs.readFile(revisionFile, 'utf8').catch(() => '')
  // The part of the credential that says whose it is; the rest changes on every mint.
  const holder = (credential) => credential.split('.')[1] ?? ''
  // Unknown until a sync here succeeds: a reopened session finds whatever an earlier
  // process left in this home, so the first failed sync empties it.
  let syncedFor
  const syncPersonal = async (timeoutMs, atPrompt) => {
    const before = await installed()
    const credentials = run?.credentialsDir ?? process.env.OPENAB_CREDENTIALS_DIR
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
      await sync(
        { NUPHOS_RUNTIME_PERSONAL_SKILLS_DIR: personal, NUPHOS_RUNTIME_SKILLS_TOKEN: credential },
        timeoutMs,
      )
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
  const [team] = await Promise.all([sync(), syncPersonal()])

  // Present even when empty, so a skill synced for a later turn is picked up.
  await fs.mkdir(skills, { recursive: true })
  options.additionalDirectories = [
    ...(options.additionalDirectories ?? []).filter((dir) => dir !== personal),
    personal,
  ]

  return team
}

// Run inside the native adapter once a session has discovered its controls,
// before OpenAB receives it or sends a prompt: on session/new, and again when a
// session is loaded or resumed. The backend sends the conversation's own
// settings (those it started with, then every change it confirmed), which the
// agent's restored state can lag: a change no turn followed is not on record.
export async function nuphosApplyRuntimeDefaults(agent, params, response, reopened = false) {
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
      // A reopened session keeps its restored value when the runtime no longer offers
      // the stored one; any other failure stops it before it can prompt.
      if (reopened) continue
      throw new Error(
        `The default ${kind} is not supported. Update this runtime in Settings → Agent, then start a new conversation.`,
      )
    }
    if (option.currentValue === value) continue
    const updated = await agent.setSessionConfigOption({
      sessionId: response.sessionId ?? params.sessionId,
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

// One bounded snapshot per conversation, in its persistent CLI home. A killed
// adapter cannot report failure, so an unfinished phase is deliberately left
// as running rather than being mislabelled as a timeout or a successful restore.
export async function nuphosTraceRestore(params, operation, restore) {
  const env =
    params?._meta?.claudeCode?.options?.env ??
    params?._meta?.['ai.nuphos/codex']?.env ??
    params?._meta?.['ai.nuphos/session']?.env ??
    {}
  const sessionId = env.NUPHOS_SESSION_ID
  let record = () => {}
  // Do not log arbitrary metadata, native error messages, prompts, or credentials.
  if (typeof sessionId === 'string' && /^[\da-f-]{36}$/iu.test(sessionId)) {
    try {
      const fs = await import('node:fs')
      const { join } = await import('node:path')
      const { homedir } = await import('node:os')
      const { createHash, randomUUID } = await import('node:crypto')
      const dir = join(
        process.env.HOME || process.env.USERPROFILE || homedir(),
        '.nuphos',
        'session-homes',
        createHash('sha256').update(sessionId).digest('hex'),
      )
      const attemptId = randomUUID()
      const file = join(dir, 'session-restore.json')
      const temporary = join(dir, `.session-restore-${attemptId}.tmp`)
      const started = performance.now()
      const steps = []
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
        fs.renameSync(file, join(dir, 'session-restore.previous.json'))
      } catch {
        /* First attempt or unavailable storage; stderr still works. */
      }
      record = (phase, status = 'running') => {
        const elapsedMs = Math.round(performance.now() - started)
        // Phase names are constants at the instrumented call sites.
        steps.push({ phase, elapsedMs })
        if (steps.length > 12) steps.shift()
        const snapshot = {
          event: 'agent.session.restore',
          sessionId,
          attemptId,
          operation,
          pid: process.pid,
          at: new Date().toISOString(),
          status,
          phase,
          elapsedMs,
          steps,
        }
        const line = `${JSON.stringify(snapshot)}\n`
        try {
          process.stderr.write(line)
        } catch {
          /* Diagnostics cannot fail a restore. */
        }
        try {
          fs.writeFileSync(temporary, line, { mode: 0o600 })
          fs.renameSync(temporary, file)
        } catch {
          try {
            fs.unlinkSync(temporary)
          } catch {
            /* Best effort only. */
          }
        }
      }
    } catch {
      /* A read-only home must not prevent session restoration. */
    }
  }
  let phase = 'skills-sync'
  const step = (next) => {
    phase = next
    record(phase)
  }
  step(phase)
  try {
    const result = await restore(step)
    record('complete', 'completed')
    return result
  } catch (error) {
    record(phase, 'failed')
    throw error
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
    return nuphosReplyImages(this, params, await nuphosApplyRuntimeDefaults(this, params, await this.nuphosNewSession(params)));
  }
  async nuphosNewSession(params) {`,
  )
  for (const handler of reopenAnchors) {
    const method = handler.includes('loadSession') ? 'loadSession' : 'resumeSession'
    body = body.replace(
      handler,
      `${handler}
        return nuphosTraceRestore(params, '${method}', async (nuphosRestorePhase) => {
            await nuphosSyncRuntimeSkills(params);
            nuphosRestorePhase('adapter-restore');
            nuphosReplyImages(this, params, { sessionId: params.sessionId });
            try {
                return await nuphosApplyRuntimeDefaults(this, params, await this.nuphos_${method}(params, nuphosRestorePhase), true);
            } finally {
                await this.nuphosFlushReplyImages?.(params.sessionId);
            }
        });
    }
    async nuphos_${method}(params, nuphosRestorePhase) {`,
    )
  }
  return `${shebang}${nuphosStreamReplyImages.toString()}\n${nuphosReplyImages.toString()}\n${nuphosUploadReplyImages.toString()}\n${nuphosSyncRuntimeSkills.toString()}\n${nuphosApplyRuntimeDefaults.toString()}\n${nuphosTraceRestore.toString()}\n${body}`
}

// Claude only. The sender of a turn may differ from the last one's, so the personal
// skills are re-synced before every prompt of a live session, which is rebuilt when
// the skills on disk changed. Strict on purpose: losing
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
