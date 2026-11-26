import assert from 'node:assert/strict'
import { test } from 'node:test'

import { gitlabBindingId } from './binding-access-scenarios.ts'

import type { Client, Flow } from './binding-access-scenarios.ts'

const stack: Flow = { apiUrl: '', token: '', teamId: 'team', signInCode: () => undefined }

// A fixture GitLab can take the port of one an earlier scenario closed, so the team
// already has a binding at the same address, for another fixture account.
test('the binding is the one for the fixture account, not an earlier one at the same address', async () => {
  const url = 'http://127.0.0.1:28640'
  const owner: Client = async () => ({
    status: 200,
    text: '',
    body: {
      bindings: [
        { id: 'earlier', hostUrl: url, accountId: 4343 },
        { id: 'this', hostUrl: url, accountId: 4545 },
      ],
    },
  })

  assert.equal(await gitlabBindingId(stack, owner, { url, accountId: 4545 }), 'this')
})
