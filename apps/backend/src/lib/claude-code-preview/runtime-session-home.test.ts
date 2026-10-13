import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { FORGET_SESSION_HOME_PROGRAM } from './runtime-session-home'

describe('FORGET_SESSION_HOME_PROGRAM', () => {
  test('removes only the archived conversation home, as the panel job runs it', () => {
    const root = mkdtempSync(join(tmpdir(), 'forget-home-'))

    try {
      const homes = join(root, 'home', '.nuphos', 'session-homes')
      const home = (id: string) => join(homes, createHash('sha256').update(id).digest('hex'))

      for (const id of ['archived', 'other']) {
        mkdirSync(join(home(id), '.local', 'bin'), { recursive: true })
        writeFileSync(join(home(id), '.local', 'bin', 'tccli'), '')
      }
      const runDir = join(root, 'run')

      mkdirSync(runDir)
      writeFileSync(join(runDir, 'runner.mjs'), FORGET_SESSION_HOME_PROGRAM)
      writeFileSync(join(runDir, 'params.json'), JSON.stringify({ sessionId: 'archived' }))
      const run = Bun.spawnSync(['node', join(runDir, 'runner.mjs'), runDir], {
        env: { PATH: process.env.PATH, HOME: join(root, 'home') },
      })

      expect(run.exitCode).toBe(0)
      expect(existsSync(home('archived'))).toBe(false)
      expect(existsSync(home('other'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
