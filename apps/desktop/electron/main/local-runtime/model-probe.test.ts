import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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

// Grok Build answers session/new with its reasoning effort but no model picker.
const EFFORT_ONLY_ADAPTER = `
  import readline from 'node:readline';
  for await (const line of readline.createInterface({ input: process.stdin })) {
    const { id, method } = JSON.parse(line);
    const result = method === 'initialize' ? {} : {
      sessionId: 'test', configOptions: [
        { id: 'reasoning_effort', category: 'thought_level', currentValue: 'high',
          options: [{ value: 'xhigh', name: 'Extra high' }, { value: 'high', name: 'High' }] },
      ],
    };
    console.log(JSON.stringify({ id, result }));
  }
`

test('a runtime with an effort control but no model list is read, not reported as a failure', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'model-probe-'))
  const adapter = path.join(dir, 'adapter.mjs')

  writeFileSync(adapter, EFFORT_ONLY_ADAPTER)
  try {
    const catalog = await probeLocalModels({
      nodeExecPath: process.execPath,
      adapter,
      cwd: dir,
      env: {},
    })

    // The composer's effort picker stays available; only the model list is absent.
    assert.equal(catalog.controlsOnly, true)
    assert.deepEqual(catalog.models, [])
    // What the runtime did advertise is kept, or the backend has nothing to offer.
    assert.deepEqual(
      catalog.controls.default?.effort.map((choice) => choice.value),
      ['xhigh', 'high'],
    )
    assert.equal(catalog.controls.default?.defaultEffort, 'high')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a runtime that offers no controls at all is still a failed read', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'model-probe-'))
  const adapter = path.join(dir, 'adapter.mjs')

  writeFileSync(
    adapter,
    `
    import readline from 'node:readline';
    for await (const line of readline.createInterface({ input: process.stdin })) {
      const { id, method } = JSON.parse(line);
      const result = method === 'initialize' ? {} : { sessionId: 'test', configOptions: [] };
      console.log(JSON.stringify({ id, result }));
    }
  `,
  )
  try {
    await assert.rejects(
      probeLocalModels({ nodeExecPath: process.execPath, adapter, cwd: dir, env: {} }),
      /did not advertise any models/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an effort level with no choices to pick is not a catalog', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'model-probe-'))
  const adapter = path.join(dir, 'adapter.mjs')

  writeFileSync(
    adapter,
    `
    import readline from 'node:readline';
    for await (const line of readline.createInterface({ input: process.stdin })) {
      const { id, method } = JSON.parse(line);
      const result = method === 'initialize' ? {} : {
        sessionId: 'test', configOptions: [
          { id: 'reasoning_effort', category: 'thought_level', currentValue: 'high', options: [] },
        ],
      };
      console.log(JSON.stringify({ id, result }));
    }
  `,
  )
  try {
    // Reporting a catalog here would open the empty popover this read exists to avoid.
    await assert.rejects(
      probeLocalModels({ nodeExecPath: process.execPath, adapter, cwd: dir, env: {} }),
      /did not advertise any models/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Cursor lists ~50 models, each id carrying its settings, and offers no effort or fast control.
const CURSOR_LIKE_ADAPTER = `
  import { writeFileSync } from 'node:fs';
  import readline from 'node:readline';
  const options = [{ value: 'default[]', name: 'Auto' }].concat(
    Array.from({ length: 48 }, (_, i) => ({ value: 'model-' + i + '[effort=high]', name: 'Model ' + i })),
  );
  let sets = 0;
  for await (const line of readline.createInterface({ input: process.stdin })) {
    const { id, method, params } = JSON.parse(line);
    if (method === 'session/set_config_option') sets++;
    const result = method === 'initialize' ? {} : {
      sessionId: 'test', configOptions: [
        { id: 'mode', currentValue: 'agent', options: [{ value: 'agent', name: 'Agent' }] },
        { id: 'model', category: 'model', currentValue: params?.value ?? 'default[]', options },
      ],
    };
    if (method === 'session/set_config_option') writeFileSync(process.env.SETS_FILE, String(sets));
    console.log(JSON.stringify({ id, result }));
  }
`

test('a runtime with no per-model controls lists all its models after one set, not one per model', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'model-probe-'))
  const adapter = path.join(dir, 'adapter.mjs')
  const setsFile = path.join(dir, 'sets')

  writeFileSync(adapter, CURSOR_LIKE_ADAPTER)
  try {
    const catalog = await probeLocalModels({
      nodeExecPath: process.execPath,
      adapter,
      cwd: dir,
      env: { SETS_FILE: setsFile },
    })

    assert.equal(catalog.models.length, 49)
    assert.equal(catalog.defaultModel, 'default[]')
    // The default's controls came with the session; one more model showing none ends the read.
    assert.equal(readFileSync(setsFile, 'utf8'), '1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a default model without controls still has every other model read', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'model-probe-'))
  const adapter = path.join(dir, 'adapter.mjs')

  // Claude offers no effort for Haiku, so a Haiku default shows none until another model is set.
  writeFileSync(
    adapter,
    `
    import readline from 'node:readline';
    const options = [{ value: 'haiku', name: 'Haiku' }, { value: 'sonnet', name: 'Sonnet' }, { value: 'opus', name: 'Opus' }];
    for await (const line of readline.createInterface({ input: process.stdin })) {
      const { id, method, params } = JSON.parse(line);
      const model = params?.value ?? 'haiku';
      const effort = model === 'haiku' ? [] : [{ id: 'effort', currentValue: 'high', options: [{ value: 'high', name: 'High' }] }];
      const result = method === 'initialize' ? {} : {
        sessionId: 'test',
        configOptions: [{ id: 'model', category: 'model', currentValue: model, options }, ...effort],
      };
      console.log(JSON.stringify({ id, result }));
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
      ['haiku', 'sonnet', 'opus'],
    )
    assert.equal(catalog.controls.sonnet?.defaultEffort, 'high')
    assert.equal(catalog.controls.opus?.defaultEffort, 'high')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// cursor-agent outlives a closed stdin, and an adapter need not pass a kill on to it.
const ORPHANING_ADAPTER = `
  import { spawn } from 'node:child_process';
  import { writeFileSync } from 'node:fs';
  import readline from 'node:readline';
  const agent = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: ['pipe', 'ignore', 'ignore'] });
  writeFileSync(process.env.AGENT_PID_FILE, String(agent.pid));
  for await (const line of readline.createInterface({ input: process.stdin })) {
    const { id, method, params } = JSON.parse(line);
    const result = method === 'initialize' ? {} : {
      sessionId: 'test', configOptions: [
        { id: 'model', category: 'model', currentValue: params?.value ?? 'a',
          options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] },
      ],
    };
    console.log(JSON.stringify({ id, result }));
  }
`

function alive(pid: number) {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

test('the agent an adapter started does not outlive the probe', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'model-probe-'))
  const adapter = path.join(dir, 'adapter.mjs')
  const pidFile = path.join(dir, 'agent-pid')

  writeFileSync(adapter, ORPHANING_ADAPTER)
  try {
    await probeLocalModels({
      nodeExecPath: process.execPath,
      adapter,
      cwd: dir,
      env: { AGENT_PID_FILE: pidFile },
    })
    const pid = Number(readFileSync(pidFile, 'utf8'))

    for (let wait = 0; wait < 20 && alive(pid); wait++) await new Promise((r) => setTimeout(r, 50))
    assert.equal(alive(pid), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
