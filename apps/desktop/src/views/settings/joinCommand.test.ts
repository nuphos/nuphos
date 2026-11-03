import assert from 'node:assert/strict'
import { test } from 'node:test'

import { joinCommand } from './joinCommand.ts'

const join = { token: 'tok', expiresAt: '', apiUrl: 'https://api.nuphos.ai' }

test('without a target it is the two commands to run on the machine', () => {
  assert.equal(
    joinCommand(join),
    'curl -fsSL https://nuphos.ai/install | sh\nNUPHOS_JOIN_TOKEN=tok nuphos agent',
  )
})

test('with a target it installs and starts the agent over SSH in one line', () => {
  assert.equal(
    joinCommand({ ...join, apiUrl: 'https://api.dev' }, ' me@box.lan '),
    "ssh me@box.lan 'curl -fsSL https://nuphos.ai/install | sh && (NUPHOS_API_URL=https://api.dev NUPHOS_JOIN_TOKEN=tok nohup ~/.local/bin/nuphos agent >~/.nuphos-agent.log 2>&1 </dev/null &)'",
  )
})

test('a target the shell would split is not used', () => {
  assert.equal(joinCommand(join, "me@host; rm -rf ~ '"), joinCommand(join))
})

test('a target ssh would read as an option is not used', () => {
  assert.equal(joinCommand(join, '-oProxyCommand'), joinCommand(join))
})
