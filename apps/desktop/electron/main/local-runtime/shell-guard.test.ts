import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { shellGuardEnv, writeZshenv } from './shell-guard.ts'

test(
  'bash and zsh read the current conversation token, not the spawn-time one',
  { skip: process.platform === 'win32' },
  () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nuphos-guard-'))
    const credentials = path.join(root, 'credentials')
    const launch = { bundle: { root }, openabHome: path.join(root, 'openab-home') }
    const print = 'printf %s "$NUPHOS_TOKEN"'

    try {
      mkdirSync(credentials)
      copyFileSync(
        path.join(import.meta.dirname, '../../../../runtime/image/runtime-guard.sh'),
        path.join(root, 'runtime-guard.sh'),
      )
      writeZshenv(launch)
      const zsh = ['/bin/zsh', '/usr/bin/zsh'].find((file) => existsSync(file))
      const shells: Record<string, string[]> = {
        bash: ['/bin/bash', '-c', print],
        ...(zsh ? { zsh: [zsh, '-c', print], 'zsh login': [zsh, '-lc', print] } : {}),
      }
      const token = ([command, ...args]: string[]) =>
        spawnSync(command, args, {
          env: {
            PATH: process.env.PATH,
            ...shellGuardEnv(launch),
            OPENAB_CREDENTIALS_DIR: credentials,
            NUPHOS_TOKEN: 'spawn',
          },
          encoding: 'utf8',
          // A pipe is a socket here, as Claude Code's shell gets.
          stdio: 'pipe',
        }).stdout

      for (const [name, shell] of Object.entries(shells)) {
        writeFileSync(path.join(credentials, 'NUPHOS_TOKEN'), `${name} 1`)
        assert.equal(token(shell), `${name} 1`)
        writeFileSync(path.join(credentials, 'NUPHOS_TOKEN'), `${name} 2`)
        assert.equal(token(shell), `${name} 2`)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
