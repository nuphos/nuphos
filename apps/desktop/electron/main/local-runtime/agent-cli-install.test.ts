import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { installCommand } from './agent-cli-install.ts'

test(
  'Pi installs with npm, the way its docs give it',
  { skip: process.platform === 'win32' },
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'npm-'))

    try {
      const npm = path.join(dir, 'npm')

      writeFileSync(npm, '#!/bin/sh\n')
      chmodSync(npm, 0o755)
      assert.deepEqual(installCommand('pi', { PATH: dir }), {
        file: npm,
        args: ['install', '-g', '@earendil-works/pi-coding-agent'],
      })
      assert.deepEqual(installCommand('opencode', { PATH: dir })?.args, [
        'install',
        '-g',
        'opencode-ai',
      ])
      assert.deepEqual(installCommand('dsh', { PATH: dir })?.args, [
        'install',
        '-g',
        '@deepseek-ai/dsh@latest',
      ])
      // Without Node.js there is nothing to install Pi with.
      assert.equal(installCommand('pi', { PATH: path.join(dir, 'none') }), null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  "Grok Build and Hermes install with their vendors' own scripts, which need no Node.js",
  { skip: process.platform === 'win32' },
  () => {
    assert.deepEqual(installCommand('grok', { PATH: '' }), {
      file: '/bin/bash',
      args: ['-c', 'curl -fsSL https://x.ai/cli/install.sh | bash'],
    })
    // Its setup asks for a provider in a terminal, which an install from Nuphos has none of.
    assert.deepEqual(installCommand('hermes', { PATH: '' }), {
      file: '/bin/bash',
      args: [
        '-c',
        'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive',
      ],
    })
  },
)
