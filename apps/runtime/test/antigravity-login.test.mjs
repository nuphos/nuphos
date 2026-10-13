import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { runAntigravityLogin } from '../image/antigravity-login.mjs'

// Like the real server: a cached token answers authenticate without asking Google;
// otherwise the browser must come back to its loopback listener first.
const FAKE_SERVER = `#!/usr/bin/env node
const { createServer } = require('node:http')
const { existsSync, mkdirSync, writeFileSync } = require('node:fs')
const dir = process.env.GEMINI_HOME + '/antigravity-acp'
const token = dir + '/acp_token.json'
const answer = () => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} }) + '\\n')
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  if (JSON.parse(line).method !== 'authenticate') return
  if (existsSync(token)) return answer()
  const server = createServer((req, res) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(token, JSON.stringify({ account: new URL(req.url, 'http://x').searchParams.get('code') }))
    res.end()
    answer()
  }).listen(0, '127.0.0.1', () => {
    const redirect = 'http://127.0.0.1:' + server.address().port + '/'
    process.stderr.write('https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=' + encodeURIComponent(redirect) + ' \\n')
  })
})
`

test('signing in again asks Google instead of reusing the cached account', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'antigravity-login-test-'))
  const executable = join(directory, 'agy-acp-server')
  const home = join(directory, 'gemini')

  try {
    await writeFile(executable, FAKE_SERVER)
    await chmod(executable, 0o755)
    await mkdir(join(home, 'antigravity-acp'), { recursive: true })
    await writeFile(join(home, 'antigravity-acp', 'acp_token.json'), '{"account":"old"}')

    const input = new PassThrough()
    const frames = []
    await runAntigravityLogin({
      executable,
      home,
      input,
      emit: (frame) => {
        frames.push(frame)
        if (frame.type === 'authorize') {
          const redirect = new URL(new URL(frame.url).searchParams.get('redirect_uri'))
          input.write(`http://127.0.0.1:${redirect.port}/?code=new\n`)
        }
      },
    })

    assert.deepEqual(
      frames.map((frame) => frame.type),
      ['authorize', 'authenticated'],
    )
    assert.deepEqual(
      JSON.parse(await readFile(join(home, 'antigravity-acp', 'acp_token.json'), 'utf8')),
      { account: 'new' },
    )
    assert.deepEqual(
      JSON.parse(await readFile(join(home, 'antigravity-acp', 'settings.json'), 'utf8')),
      { auth: { type: 'oauth-personal' } },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
