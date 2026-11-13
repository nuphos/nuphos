import { spawn } from 'node:child_process'

import { agentEnv } from './config.ts'
import { customProviderLaunch } from './custom-provider.ts'

import type { LocalRuntimeBundle } from './config.ts'
import type { KeyStore } from './custom-provider.ts'
import type { ProbeModelsRun } from './controller-types.ts'

export type ModelControls = {
  effort: { value: string; name: string; description?: string }[]
  /** Off and each speed the adapter offers; empty when it has none. */
  fast: { value: string; name: string; description?: string }[]
  defaultFast?: string
  defaultEffort?: string
}

/**
 * What the adapter offers before any conversation, reported so teams can pick up front.
 * A runtime may offer controls without a model list (Grok Build reports its effort and
 * no model picker), so the models are empty there rather than the whole read failing.
 */
export type LocalModelCatalog = {
  models: { id: string; name: string; description?: string }[]
  /** The model the controls were read for; empty when none was listed. */
  defaultModel: string
  controls: Record<string, ModelControls>
  /** Controls but no model list: `controls` holds one entry and a pick starts the session. */
  controlsOnly?: true
}

type ConfigOption = {
  id?: unknown
  category?: unknown
  currentValue?: unknown
  options?: { value?: unknown; name?: unknown; description?: unknown }[]
}

const PROBE_TIMEOUT_MS = 30_000

/** The `controls` key of a catalog with no model: no model names the session it applies to. */
export const CONTROLS_ONLY_KEY = 'default'

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
  const speeds = choices(fast)

  return {
    ...(typeof effort?.currentValue === 'string' ? { defaultEffort: effort.currentValue } : {}),
    effort: choices(effort),
    fast: speeds.some((choice) => choice.value === 'off') ? speeds : [],
    ...(typeof fast?.currentValue === 'string' ? { defaultFast: fast.currentValue } : {}),
  }
}

/** A runtime's settings when it lists no models, or null when it offers no choices. */
function settingsOnlyCatalog(configOptions: ConfigOption[]): LocalModelCatalog | null {
  const controls = controlsOf(configOptions)

  // Choices only: an empty level is nothing to pick, so it would open an empty popover.
  if (!controls.effort.length && !controls.fast.length) return null

  return {
    models: [],
    defaultModel: '',
    controls: { [CONTROLS_ONLY_KEY]: controls },
    controlsOnly: true,
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
  /** A custom provider's key, which reaches the adapter only in its environment. */
  secretEnv?: Record<string, string>
  /** A custom provider's own model ids, offered instead of the adapter's list. */
  models?: string[]
}): Promise<LocalModelCatalog> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.nodeExecPath, [options.adapter], {
      cwd: options.cwd,
      env: { ...options.env, ...options.secretEnv },
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
      finish(new Error('The runtime exited during model discovery'))
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
      const advertised = modelChoices(model)
      // Each id is still tried below, so one the adapter refuses is left out.
      const { models, defaultModel } = options.models?.length
        ? {
            models: options.models.map((id) => ({ id, name: id })),
            defaultModel: options.models[0],
          }
        : advertised

      if (!model || typeof model.currentValue !== 'string' || models.length === 0) {
        // Grok Build offers effort and no model: report that, or fail as before if it offers none.
        const only = settingsOnlyCatalog(configOptions)

        if (only) finish(null, only)
        else finish(new Error('The runtime did not advertise any models'))

        return
      }
      const controls: Record<string, ModelControls> = {
        [defaultModel as string]: controlsOf(configOptions),
      }

      for (const { id } of models) {
        // Claude validates full model ids with a network call that can fail
        // once; try again before reporting the model without its controls.
        for (let attempt = 0; attempt < 2 && !controls[id]; attempt++) {
          try {
            const updated = await call('session/set_config_option', {
              sessionId,
              configId: model.id,
              value: id,
            })

            configOptions = (updated.configOptions ?? configOptions) as ConfigOption[]
            controls[id] = controlsOf(configOptions)
          } catch {
            // Still rejected after a retry: leave it out. A pick made before the
            // first reply is applied at session creation, where a rejected model
            // would fail the conversation's first message.
          }
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

/** `probeModels` for a host that stages `bundle`: the adapter runs as it would under openab. */
/** `keys` holds the custom providers' keys, whose models the probe then offers. */
export function bundledModelProbe(bundle: () => LocalRuntimeBundle | null, keys?: KeyStore) {
  return async ({ provider, workspace, env, cliPath, agentHome }: ProbeModelsRun) => {
    const staged = bundle()
    const adapter = staged?.adapters[provider]

    if (!staged || !adapter) throw new Error('The local runtime is not bundled')
    const custom = keys && (await customProviderLaunch(keys, provider, agentHome))

    return probeLocalModels({
      nodeExecPath: process.execPath,
      adapter: adapter.entry,
      cwd: workspace,
      env: agentEnv({
        provider,
        bundle: staged,
        adapter,
        nodeExecPath: process.execPath,
        cliPath,
        agentHome,
        workspace,
        openabHome: workspace,
        port: 0,
        authKey: '',
        env,
      }),
      ...(custom ? { secretEnv: custom.env, models: custom.models } : {}),
    })
  }
}
