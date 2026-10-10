import { describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'

import { OpenAbRpcError } from './openab-acp-errors'
import {
  catalogSessionConfig,
  controlSessionConfig,
  offeredSessionConfig,
  restoreSessionConfigForWrite,
} from './session-config'
import { parseSessionConfigOptions } from './session-config-options'

const model = (currentValue = 'a') => ({
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue,
  options: [
    { value: 'a', name: 'A' },
    { value: 'b', name: 'B' },
  ],
})
const effort = {
  id: 'reasoning_effort',
  name: 'Reasoning effort',
  type: 'select',
  currentValue: 'high',
  options: [{ value: 'high', name: 'High' }],
}
const fast = {
  id: 'fast-mode',
  name: 'Fast mode',
  type: 'select',
  currentValue: 'off',
  options: [
    { value: 'off', name: 'Off' },
    { value: 'on', name: 'On' },
  ],
}

test('restores an owner’s dormant session only before explicitly changing its native model', async () => {
  const calls: unknown[] = []
  const context = { cwd: '/saved', _meta: { owner: 'owner' } }
  const client = {
    getSessionConfigOptions: async (id: string, restore?: Record<string, unknown>) => {
      calls.push({ id, restore })
      if (!restore) throw new OpenAbRpcError('dormant', -32004)

      return { configOptions: [model('b'), effort, fast] }
    },
    setSessionConfigOption: async () => {
      throw new Error('must not write')
    },
  }
  const state = await restoreSessionConfigForWrite(
    client,
    'stored',
    'owner',
    'owner',
    async () => context,
  )

  expect(state.status).toBe('ready')
  expect(state.options[0]?.currentValue).toBe('b')
  expect(calls).toEqual([
    { id: 'stored', restore: undefined },
    { id: 'stored', restore: context },
  ])
})

test('viewers cannot restore an owner session, and busy sessions are not restarted', async () => {
  for (const [code, viewer] of [
    [-32004, 'viewer'],
    [-32005, 'owner'],
  ] as const) {
    const state = await restoreSessionConfigForWrite(
      {
        getSessionConfigOptions: async () => {
          throw new OpenAbRpcError('unavailable', code)
        },
        setSessionConfigOption: async () => ({}),
      },
      'stored',
      'owner',
      viewer,
      async () => {
        throw new Error('must not mint owner context')
      },
    )

    expect(state.status).toBe(code === -32005 ? 'busy' : 'dormant')
    expect(state.options).toEqual([])
  }
})

describe('OpenAB session model configuration', () => {
  test('exposes actual models, effort and fast; excludes permission controls', () => {
    const options = parseSessionConfigOptions([
      model(),
      effort,
      fast,
      { ...model(), id: 'mode', category: 'mode' },
    ])

    expect(options.map((option) => option.kind)).toEqual(['model', 'effort', 'fast'])
    expect(options[0]?.currentValue).toBe('a')
  })

  test('uses the complete runtime acknowledgement when model changes the other options', async () => {
    const writes: unknown[] = []
    const state = await controlSessionConfig(
      {
        getSessionConfigOptions: async () => ({ configOptions: [model(), effort, fast] }),
        setSessionConfigOption: async (...args) => {
          writes.push(args)

          return { configOptions: [model('b')] }
        },
      },
      'session-one',
      { configId: 'model', value: 'b' },
    )

    expect(writes).toEqual([['session-one', 'model', 'b']])
    expect(state.options).toEqual(parseSessionConfigOptions([model('b')]))
  })

  test('rejects stale values and permission changes without forwarding them', async () => {
    let writes = 0
    const client = {
      getSessionConfigOptions: async () => ({ configOptions: [model()] }),
      setSessionConfigOption: async () => {
        writes++

        return {}
      },
    }

    for (const selection of [
      { configId: 'model', value: 'missing' },
      { configId: 'mode', value: 'bypass' },
    ]) {
      await expect(controlSessionConfig(client, 'session-one', selection)).rejects.toMatchObject({
        code: 'invalid_runtime_config',
      })
    }
    expect(writes).toBe(0)
  })

  test('does not claim success on rejected changes or missing acknowledgement', async () => {
    await expect(
      controlSessionConfig(
        {
          getSessionConfigOptions: async () => ({ configOptions: [model()] }),
          setSessionConfigOption: async () => {
            throw new OpenAbRpcError('agent rejected', -32603)
          },
        },
        'session-one',
        { configId: 'model', value: 'b' },
      ),
    ).rejects.toThrow('agent rejected')
    expect(() => parseSessionConfigOptions(undefined)).toThrow('did not return')
  })

  test('distinguishes busy, dormant and unsupported runtimes and refuses writes', async () => {
    for (const [code, status] of [
      [-32004, 'dormant'],
      [-32005, 'busy'],
      [-32601, 'unsupported'],
    ] as const) {
      const client = {
        getSessionConfigOptions: async () => {
          throw new OpenAbRpcError(status, code)
        },
        setSessionConfigOption: async () => ({}),
      }

      expect(await controlSessionConfig(client, 'session-one')).toEqual({ status, options: [] })
      await expect(
        controlSessionConfig(client, 'session-one', { configId: 'model', value: 'a' }),
      ).rejects.toMatchObject({ status: 409 })
    }
  })
})

test('restore races preserve busy/unsupported and failed loads return a retryable conflict', async () => {
  for (const code of [-32005, -32601, -32004, -32603]) {
    const client = {
      getSessionConfigOptions: async (_id: string, restore?: Record<string, unknown>) => {
        throw new OpenAbRpcError('restore failure', restore ? code : -32004)
      },
      setSessionConfigOption: async () => ({}),
    }
    const result = restoreSessionConfigForWrite(client, 'saved', 'owner', 'owner', async () => ({
      cwd: '/saved',
    }))

    if (code === -32005 || code === -32601)
      expect(await result).toEqual({
        status: code === -32005 ? 'busy' : 'unsupported',
        options: [],
      })
    else
      await expect(result).rejects.toMatchObject({
        status: 409,
        code: 'runtime_config_unavailable',
      })
  }
})

test('restore context failures have safe retry messaging and preserve authorization errors', async () => {
  for (const failure of [
    new Error('private context failure'),
    new AppError(403, 'forbidden', 'Denied'),
  ]) {
    const result = restoreSessionConfigForWrite(
      {
        getSessionConfigOptions: async () => {
          throw new OpenAbRpcError('dormant', -32004)
        },
        setSessionConfigOption: async () => ({}),
      },
      'saved',
      'owner',
      'owner',
      async () => {
        throw failure
      },
    )

    await expect(result).rejects.toMatchObject(
      failure instanceof AppError
        ? { status: 403, code: 'forbidden' }
        : { status: 409, message: 'The saved session could not be restored. Try again.' },
    )
  }
})

test('reading dormant model settings never restores the runtime', async () => {
  const calls: unknown[] = []
  const state = await controlSessionConfig(
    {
      getSessionConfigOptions: async (...args) => {
        calls.push(args)
        throw new OpenAbRpcError('dormant', -32004)
      },
      setSessionConfigOption: async () => {
        throw new Error('must not write')
      },
    },
    'stored',
  )

  expect(state).toEqual({ status: 'dormant', options: [] })
  expect(calls).toEqual([['stored']])
})

test('a runtime catalog becomes session options; picks it no longer offers fall back to its own', () => {
  const catalog = {
    models: [
      { id: 'default', name: 'Default' },
      { id: 'opus', name: 'Opus' },
    ],
    controls: {
      modelId: 'default',
      effort: [{ value: 'high', name: 'High' }],
      fast: true,
      defaultEffort: 'high',
    },
  }

  expect(
    catalogSessionConfig(catalog, { effort: 'gone' }).map((option) => option.currentValue),
  ).toEqual(['default', 'high', 'off'])
  expect(catalogSessionConfig(catalog, { model: 'opus', fast: 'on' })).toMatchObject([
    {
      id: 'model',
      kind: 'model',
      currentValue: 'opus',
      options: [{ value: 'default' }, { value: 'opus' }],
    },
    { id: 'effort', kind: 'effort' },
    { id: 'fast', kind: 'fast', currentValue: 'on' },
  ])
  expect(catalogSessionConfig({ models: [] }, {})).toEqual([])
})

test('picks the runtime no longer offers are dropped, and a stale model is read again without it', async () => {
  const requested: (string | undefined)[] = []
  const catalogFor = async (model?: string) => {
    requested.push(model)
    if (model === 'retired') throw new Error('Model discovery failed')

    return {
      models: [{ id: 'opus', name: 'Opus' }],
      controls: { modelId: 'opus', effort: [{ value: 'high', name: 'High' }], fast: false },
    }
  }

  const { options, kept } = await offeredSessionConfig(catalogFor, {
    model: 'retired',
    effort: 'high',
    fast: 'on',
  })

  expect(requested).toEqual(['retired', undefined])
  expect(kept).toEqual({ effort: 'high' })
  expect(options.map((option) => [option.id, option.currentValue])).toEqual([
    ['model', 'opus'],
    ['effort', 'high'],
  ])
})
