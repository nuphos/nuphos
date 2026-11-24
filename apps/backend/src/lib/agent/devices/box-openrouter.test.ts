import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from 'bun:test'

import { GIFT_MODEL, OPENCODE_OPENROUTER_COMMAND } from './box-openrouter'

test('the Box command gives the runtime’s OpenCode home the key and the model, readable only by its owner', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'box-openrouter-'))

  try {
    const run = Bun.spawnSync(['bash', '-c', OPENCODE_OPENROUTER_COMMAND], {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        NUPHOS_USER_ID: 'u1',
        OPENROUTER_API_KEY: 'sk-or-v1-abc',
      },
    })

    expect(run.exitCode).toBe(0)
    const dir = path.join(home, '.local/share/nuphos/agent/users/u1/opencode-home/.config/opencode')
    const file = path.join(dir, 'opencode.json')

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      model: GIFT_MODEL,
      small_model: GIFT_MODEL,
      provider: { openrouter: { options: { apiKey: 'sk-or-v1-abc' } } },
    })
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
