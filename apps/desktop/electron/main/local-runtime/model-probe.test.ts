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
  assert.equal(
    controls.effort.some((option) => option.value === controls.defaultEffort),
    true,
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
