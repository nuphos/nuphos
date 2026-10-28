import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  nuphosOomKills,
  nuphosOwnCgroup,
  nuphosProcessDeathMessage,
} from '../image/process-death.mjs'

// A real cgroup path is required for the limit walk, which stops at /sys/fs/cgroup.
function fakeCgroup(oomKill) {
  const root = mkdtempSync(join(tmpdir(), 'cg-'))
  const scope = join(root, 'agents.slice', 'openab.scope')

  mkdirSync(scope, { recursive: true })
  writeFileSync(join(scope, 'memory.events'), `low 0\nhigh 0\nmax 9\noom 1\noom_kill ${oomKill}\n`)

  return scope
}

test('reads its own cgroup v2 path', () => {
  assert.equal(
    nuphosOwnCgroup('0::/user.slice/nuphos-agents.slice/openab.scope\n'),
    '/sys/fs/cgroup/user.slice/nuphos-agents.slice/openab.scope',
  )
  assert.equal(nuphosOwnCgroup(null), null)
})

test('counts OOM kills from memory.events', () => {
  assert.equal(nuphosOomKills(fakeCgroup(3)), 3)
  assert.equal(nuphosOomKills(null), 0)
})

test('a SIGKILL while the OOM kill count rose names the memory limit', () => {
  const text = nuphosProcessDeathMessage(
    'Claude Code',
    'process terminated by signal SIGKILL',
    fakeCgroup(1),
    0,
  )

  assert.match(text, /ran out of memory/)
  assert.match(text, /Send a message to continue/)
  assert.doesNotMatch(text, /new session/)
})

test('a SIGKILL without an OOM kill keeps its signal', () => {
  const text = nuphosProcessDeathMessage(
    'Claude Code',
    'process terminated by signal SIGKILL',
    fakeCgroup(2),
    2,
  )

  assert.equal(
    text,
    'Claude Code stopped unexpectedly (process terminated by signal SIGKILL). Send a message to continue.',
  )
})

test('another death keeps its own reason, also outside a cgroup', () => {
  assert.equal(
    nuphosProcessDeathMessage('Codex', 'process terminated by signal SIGABRT', null, 0),
    'Codex stopped unexpectedly (process terminated by signal SIGABRT). Send a message to continue.',
  )
})
