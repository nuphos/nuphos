import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { probeAgentCli } from './agent-cli.ts'

test(
  'an empty or unsuccessful dsh version is not usable',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-probe-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(path.join(dir, 'node'), '#!/bin/sh\necho v20.20.2\n', { mode: 0o755 })
    const env = { HOME: dir, PATH: dir }

    for (const script of ['#!/bin/sh\nexit 0\n', '#!/bin/sh\necho 0.2.2\nexit 1\n']) {
      writeFileSync(path.join(dir, 'dsh'), script, { mode: 0o755 })
      const status = await probeAgentCli('dsh', env, dir)
      assert.equal(status.installed, false)
      assert.match(status.installed ? '' : (status.error ?? ''), /Node 24\.9 or newer.*v20\.20\.2/)
    }
  },
)

test(
  'a wrapper that prints a version is usable even with an old PATH Node',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-probe-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(path.join(dir, 'node'), '#!/bin/sh\necho v20.20.2\n', { mode: 0o755 })
    writeFileSync(path.join(dir, 'dsh'), '#!/bin/sh\necho development-build\n', { mode: 0o755 })
    const status = await probeAgentCli('dsh', { HOME: dir, PATH: dir }, dir)

    assert.equal(status.installed, true)
  },
)

test(
  'Node 22.17 with a silent dsh is also reported as unusable',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-probe-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(path.join(dir, 'node'), '#!/bin/sh\necho v22.17.0\n', { mode: 0o755 })
    writeFileSync(path.join(dir, 'dsh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const status = await probeAgentCli('dsh', { HOME: dir, PATH: dir }, dir)

    assert.equal(status.installed, false)
    assert.match(status.installed ? '' : (status.error ?? ''), /v22\.17\.0/)
  },
)
