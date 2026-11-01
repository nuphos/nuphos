import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { controlsOf, modelChoices, probeLocalModels } from './model-probe.ts'

test('reports the actual initial effort and fast values for selectors', () => {
  const controls = controlsOf([
    {
      id: 'effort',
      currentValue: 'high',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
    },
    {
      id: 'fast',
      currentValue: 'off',
      options: [
        { value: 'on', name: 'On' },
        { value: 'off', name: 'Off' },
      ],
    },
  ])

  assert.equal(controls.defaultEffort, 'high')
  assert.equal(controls.defaultFast, 'off')
  assert.deepEqual(
    controls.fast.map((choice) => choice.value),
    ['on', 'off'],
  )
  assert.equal(
    controls.effort.some((option) => option.value === controls.defaultEffort),
    true,
  )
})

test('reports every speed a Codex model offers, and none without an off choice', () => {
  const speeds = [
    { value: 'off', name: 'Off' },
    { value: 'on', name: 'Fast' },
    { value: 'ultrafast', name: 'Ultrafast' },
  ]

  assert.deepEqual(controlsOf([{ id: 'fast-mode', currentValue: 'ultrafast', options: speeds }]), {
    effort: [],
    fast: speeds,
    defaultFast: 'ultrafast',
  })
  assert.deepEqual(
    controlsOf([{ id: 'fast-mode', currentValue: 'on', options: [speeds[1]] }]).fast,
    [],
  )
})

test('Claude default resolves to its advertised named model without a duplicate Default row', () => {
  const result = modelChoices({
    currentValue: 'default',
    options: [
      { value: 'default', name: 'Default', description: 'Opus' },
      { value: 'sonnet', name: 'Sonnet' },
      { value: 'opus', name: 'Opus' },
    ],
  })

  assert.equal(result.defaultModel, 'opus')
  assert.deepEqual(
    result.models.map((model) => model.id),
    ['sonnet', 'opus'],
  )
})

test('an explicitly selected Claude model is preserved', () => {
  assert.equal(
    modelChoices({
      currentValue: 'sonnet',
      options: [
        { value: 'default', name: 'Default', description: 'Opus' },
        { value: 'sonnet', name: 'Sonnet' },
        { value: 'opus', name: 'Opus' },
      ],
    }).defaultModel,
    'sonnet',
  )
})

test('one rejected model does not discard the catalog or stop discovery of later models', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'model-probe-'))
  const adapter = path.join(dir, 'adapter.mjs')

  writeFileSync(
    adapter,
    `
    import readline from 'node:readline';
    const options = [
      { value: 'default', name: 'Default', description: 'Sonnet' },
      { value: 'sonnet', name: 'Sonnet' },
      { value: 'rejected', name: 'Rejected' },
      { value: 'haiku', name: 'Haiku' },
    ];
    for await (const line of readline.createInterface({ input: process.stdin })) {
      const { id, method, params } = JSON.parse(line);
      const error = params?.value === 'rejected' ? { code: -32603, message: 'Cannot confirm model with API' } : null;
      const result = method === 'initialize' ? {} : {
        sessionId: 'test', configOptions: [
          { id: 'model', category: 'model', currentValue: params?.value ?? 'default', options },
          { id: 'effort', currentValue: 'high', options: [{ value: 'high', name: 'High' }] },
        ],
      };
      console.log(JSON.stringify(error ? { id, error } : { id, result }));
    }
  `,
  )
  try {
    const catalog = await probeLocalModels({
      nodeExecPath: process.execPath,
      adapter,
      cwd: dir,
      env: {},
    })

    assert.equal(catalog.defaultModel, 'sonnet')
    assert.deepEqual(
      catalog.models.map(({ id }) => id),
      ['sonnet', 'haiku'],
    )
    assert.equal(catalog.controls.haiku.defaultEffort, 'high')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a model that fails once is retried and listed', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'model-probe-'))
  const adapter = path.join(dir, 'adapter.mjs')

  writeFileSync(
    adapter,
    `
    import readline from 'node:readline';
    const options = [{ value: 'opus', name: 'Opus 5.5' }, { value: 'claude-opus-4-7', name: 'Opus 4.7' }];
    let failed = false;
    for await (const line of readline.createInterface({ input: process.stdin })) {
      const { id, method, params } = JSON.parse(line);
      const flaky = params?.value === 'claude-opus-4-7' && !failed;
      if (flaky) failed = true;
      const result = method === 'initialize' ? {} : {
        sessionId: 'test', configOptions: [
          { id: 'model', category: 'model', currentValue: params?.value ?? 'opus', options },
          { id: 'effort', currentValue: 'high', options: [{ value: 'high', name: 'High' }] },
        ],
      };
      console.log(JSON.stringify(flaky ? { id, error: { code: -32603, message: 'Network' } } : { id, result }));
    }
  `,
  )
  try {
    const catalog = await probeLocalModels({
      nodeExecPath: process.execPath,
      adapter,
      cwd: dir,
      env: {},
    })

    assert.deepEqual(
      catalog.models.map(({ id }) => id),
      ['opus', 'claude-opus-4-7'],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
