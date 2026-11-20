import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { dshNodeProblem } from '../image/acp-shim.mjs'

const shim = new URL('../image/acp-shim.mjs', import.meta.url).pathname

test(
  'a dsh npm script on Node 20 reports the actual unsupported version before spawning',
  { skip: process.platform === 'win32' },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'nuphos-dsh-node-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const dsh = join(dir, 'dsh')
    writeFileSync(dsh, '#!/usr/bin/env node\n', { mode: 0o755 })
    writeFileSync(join(dir, 'node'), '#!/bin/sh\nprintf "v20.20.2\\n"\n', { mode: 0o755 })
    const result = spawnSync(process.execPath, [shim, 'dsh'], {
      env: {
        ...process.env,
        HOME: dir,
        PATH: `${dir}:${process.env.PATH}`,
        NUPHOS_AGENT_EXECUTABLE: dsh,
      },
      input: '',
      encoding: 'utf8',
      timeout: 10000,
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /requires Node\.js 24\.9\.0 or newer.*20\.20\.2/)
  },
)

test(
  'a supported PATH Node is accepted, while a custom wrapper keeps its own Node',
  { skip: process.platform === 'win32' },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'nuphos-dsh-node-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const dsh = join(dir, 'dsh')
    const node = join(dir, 'node')
    const env = { PATH: `${dir}:${process.env.PATH}` }
    writeFileSync(node, '#!/bin/sh\nprintf "v24.9.0\\n"\n', { mode: 0o755 })
    writeFileSync(dsh, '#!/usr/bin/env node\n', { mode: 0o755 })
    assert.equal(dshNodeProblem(dsh, env), undefined)
    writeFileSync(node, '#!/bin/sh\nprintf "v20.20.2\\n"\n', { mode: 0o755 })
    assert.match(dshNodeProblem(dsh, env), /24\.9\.0.*20\.20\.2/)
    writeFileSync(dsh, '#!/bin/sh\nexec /bundled/node /bundled/dsh "$@"\n', { mode: 0o755 })
    assert.equal(dshNodeProblem(dsh, env), undefined)
  },
)

test(
  'the npm Windows shim uses its adjacent Node when present',
  { skip: process.platform === 'win32' },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'nuphos-dsh-cmd-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const dsh = join(dir, 'dsh.cmd')
    writeFileSync(
      dsh,
      '@ECHO off\nIF EXIST "%dp0%\\node.exe" (\n)\n"%_prog%" "%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*\n',
    )
    writeFileSync(join(dir, 'node.exe'), '#!/bin/sh\nprintf "v24.9.0\\n"\n', { mode: 0o755 })
    writeFileSync(join(dir, 'node'), '#!/bin/sh\nprintf "v20.20.2\\n"\n', { mode: 0o755 })
    assert.equal(dshNodeProblem(dsh, { PATH: `${dir}:${process.env.PATH}` }, 'win32'), undefined)
    writeFileSync(join(dir, 'node.exe'), '#!/bin/sh\nprintf "v20.20.2\\n"\n', { mode: 0o755 })
    assert.match(
      dshNodeProblem(dsh, { PATH: `${dir}:${process.env.PATH}` }, 'win32'),
      /24\.9\.0.*20\.20\.2/,
    )
  },
)
