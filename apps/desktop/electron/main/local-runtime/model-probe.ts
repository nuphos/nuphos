import { spawn } from 'node:child_process'

export type ModelControls = {
  effort: { value: string; name: string }[]
  fast: boolean
  defaultFast?: 'on' | 'off'
  defaultEffort?: string
}

/** What the adapter offers before any conversation, reported so teams can pick up front. */
export type LocalModelCatalog = {
  models: { id: string; name: string; description?: string }[]
  defaultModel: string
  controls: Record<string, ModelControls>
}

type ConfigOption = {
  id?: unknown
  category?: unknown
  currentValue?: unknown
  options?: { value?: unknown; name?: unknown; description?: unknown }[]
}

const PROBE_TIMEOUT_MS = 30_000

function findOption(options: ConfigOption[], kind: 'model' | 'effort' | 'fast') {
  return options.find((option) => {
    if (kind === 'model') return option.category === 'model' || option.id === 'model'
    if (kind === 'effort')
      return (
        option.category === 'thought_level' ||
        ['reasoning_effort', 'effort', 'thinking'].includes(String(option.id))
      )

    return ['fast-mode', 'fast_mode', 'fast'].includes(String(option.id))
  })
}

function choices(option: ConfigOption | undefined) {
  return (option?.options ?? []).flatMap((choice) =>
    typeof choice.value === 'string' && typeof choice.name === 'string'
      ? [
          {
            value: choice.value,
            name: choice.name,
            ...(typeof choice.description === 'string' ? { description: choice.description } : {}),
          },
        ]
      : [],
  )
}

export function modelChoices(model: ConfigOption | undefined) {
  const advertised = choices(model)
  const inherited = advertised.find((option) => option.value === 'default')
  const resolved = advertised.find(
    (option) =>
      option.value !== 'default' &&
      (option.name === inherited?.description || option.value === inherited?.description),
  )
  const defaultModel =
    model?.currentValue === 'default' && resolved ? resolved.value : model?.currentValue
  const models = advertised
    .filter((option) => option.value !== 'default' || !resolved)
    .map(({ value, name, description }) => ({
      id: value,
      name: value === 'default' && inherited?.description ? inherited.description : name,
      ...(description ? { description } : {}),
    }))

  return { models, defaultModel }
}

export function controlsOf(options: ConfigOption[]): ModelControls {
  const effort = findOption(options, 'effort')
  const fast = findOption(options, 'fast')
  const fastValues = new Set(choices(fast).map((choice) => choice.value))

  return {
    ...(typeof effort?.currentValue === 'string' ? { defaultEffort: effort.currentValue } : {}),
    effort: choices(effort).map(({ value, name }) => ({ value, name })),
    fast: fastValues.has('on') && fastValues.has('off'),
    ...(fast?.currentValue === 'on' || fast?.currentValue === 'off'
      ? { defaultFast: fast.currentValue }
      : {}),
  }
}

/**
 * Opens one disposable session on the adapter, never prompts it, and reads the
 * models and per-model controls it advertises.
 */
export function probeLocalModels(options: {
  nodeExecPath: string
  adapter: string
  cwd: string
  env: Record<string, string>
}): Promise<LocalModelCatalog> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.nodeExecPath, [options.adapter], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      finish(new Error('Model discovery timed out'))
    }, PROBE_TIMEOUT_MS)
    let buffer = ''
    let nextId = 1
    const waiting = new Map<
      number,
      { resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }
    >()
    const finish = (error: Error | null, catalog?: LocalModelCatalog) => {
      clearTimeout(timer)
      child.kill()
      if (error) reject(error)
      else if (catalog) resolve(catalog)
    }
    const call = (method: string, params: unknown) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = nextId++

        waiting.set(id, { resolve, reject })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })

    child.once('error', (error) => {
      finish(error)
    })
    child.once('exit', () => {
      finish(new Error('The agent exited during model discovery'))
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline)

        buffer = buffer.slice(newline + 1)
        let frame: {
          id?: number
          method?: string
          result?: Record<string, unknown>
          error?: unknown
        }

        try {
          frame = JSON.parse(line) as typeof frame
        } catch {
          continue
        }
        if (frame.method && frame.id !== undefined) {
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Unavailable' } })}\n`,
          )
        } else if (frame.id !== undefined && waiting.has(frame.id)) {
          const request = waiting.get(frame.id)

          if (frame.error)
            request?.reject(
              new Error(`Model discovery failed: ${JSON.stringify(frame.error).slice(0, 300)}`),
            )
          else request?.resolve(frame.result ?? {})
          waiting.delete(frame.id)
        }
      }
    })

    void (async () => {
      await call('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'nuphos-model-discovery', version: '1' },
      })
      const session = await call('session/new', { cwd: options.cwd, mcpServers: [] })
      const sessionId = String(session.sessionId)
      let configOptions = (session.configOptions ?? []) as ConfigOption[]
      const model = findOption(configOptions, 'model')
      const { models, defaultModel } = modelChoices(model)

      if (!model || typeof model.currentValue !== 'string' || models.length === 0) {
        finish(new Error('The agent did not advertise any models'))

        return
      }
      const controls: Record<string, ModelControls> = {
        [defaultModel as string]: controlsOf(configOptions),
      }

      for (const { id } of models) {
        if (controls[id]) continue
        try {
          const updated = await call('session/set_config_option', {
            sessionId,
            configId: model.id,
            value: id,
          })

          configOptions = (updated.configOptions ?? configOptions) as ConfigOption[]
          controls[id] = controlsOf(configOptions)
        } catch {
          // One advertised model can fail validation without invalidating the catalog.
        }
      }
      finish(null, {
        models: models.filter(({ id }) => controls[id]),
        defaultModel: defaultModel as string,
        controls,
      })
    })().catch((error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)))
    })
  })
}
