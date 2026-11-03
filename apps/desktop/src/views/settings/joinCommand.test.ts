import assert from 'node:assert/strict'
import { test } from 'node:test'

import { joinCommand } from './joinCommand.ts'

test('the two commands to run on the machine, naming only a non-default API', () => {
  const join = { token: 'tok', expiresAt: '', apiUrl: 'https://api.nuphos.ai' }

  assert.equal(
    joinCommand(join),
    'curl -fsSL https://nuphos.ai/install | sh\nNUPHOS_JOIN_TOKEN=tok nuphos agent',
  )
  assert.match(
    joinCommand({ ...join, apiUrl: 'https://api.dev' }),
    /NUPHOS_API_URL=https:\/\/api.dev /,
  )
})
