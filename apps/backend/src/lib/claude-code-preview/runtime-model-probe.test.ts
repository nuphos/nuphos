/* eslint-disable sonarjs/no-os-command-from-path -- Test PATH intentionally selects the isolated fake adapter. */
import { test, expect } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RUNTIME_MODEL_PROBE } from './runtime-model-probe'

test('model discovery works as an operator job without a conversation or prompt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-models-'))

  try {
    const adapter = join(dir, 'codex-acp')

    writeFileSync(
      adapter,
      `#!/usr/bin/env node
const readline = require('node:readline');
let model = 'model-a';
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (!['initialize', 'session/new', 'session/set_config_option'].includes(request.method)) process.exit(9);
  if (request.method === 'session/set_config_option') model = request.params.value;
  const result = request.method === 'initialize' ? {} : {
    sessionId: 'disposable', configOptions: [
      { id: 'model', currentValue: model, options: [{value:'model-a',name:'A'},{value:'model-b',name:'B'}] },
      { id: 'effort', currentValue: 'high', options: [{value:'high',name:'High'}] }
    ]
  };
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});`,
      { mode: 0o700 },
    )
    const program = RUNTIME_MODEL_PROBE.replaceAll("'/workspace'", JSON.stringify(dir))
    const runner = join(dir, 'runner.mjs')

    writeFileSync(runner, program)
    writeFileSync(join(dir, 'params.json'), JSON.stringify({ provider: 'codex', model: 'model-b' }))
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` }
    const result = JSON.parse(
      execFileSync('node', [runner, dir], { env, encoding: 'utf8', timeout: 5000 }),
    )

    expect(result.controls).toMatchObject({
      modelId: 'model-b',
      defaultEffort: 'high',
      fast: false,
    })
    expect(result.models).toHaveLength(2)
    const direct = JSON.parse(
      execFileSync('node', ['--input-type=module', '-e', program, 'codex'], {
        env,
        encoding: 'utf8',
        timeout: 5000,
      }),
    )

    expect(direct.controls.modelId).toBe('model-a')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
