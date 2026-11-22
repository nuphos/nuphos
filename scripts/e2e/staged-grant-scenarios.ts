// Scenarios about an OAuth grant the provider callback staged for the requester to complete.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import { client, joinAsAdmin, must } from './binding-access-scenarios.ts'

import type { Flow } from './binding-access-scenarios.ts'
import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** Stages a Trello grant the way callbacks did before they kept its access: no list on it. */
function stageLegacyTrelloGrant(stack: Pick<Stack, 'mongoUri' | 'teamId'>, userId: string) {
  const state = randomBytes(16).toString('hex')
  const code = randomBytes(24).toString('base64url')
  const grant = {
    _id: state,
    codeHash: createHash('sha256').update(code).digest('hex'),
    provider: 'trello',
    requesterUserId: userId,
    binding: {
      memberId: `trello-${state}`,
      username: `staged-${state.slice(0, 6)}`,
      composioAccountId: `ca_${state}`,
      composioUserId: `cu_${state}`,
      authorizedBy: userId,
    },
  }

  execFileSync(
    'bun',
    [
      '-e',
      `
      import { MongoClient, ObjectId } from 'mongodb'
      const client = await new MongoClient(process.argv[1]).connect()
      const grant = JSON.parse(process.argv[3])
      await client.db('nuphos_e2e').collection('connector_oauth_ready').insertOne({
        ...grant,
        teamId: new ObjectId(process.argv[2]),
        expiresAt: new Date(Date.now() + 600_000),
      })
      await client.close()`,
      stack.mongoUri,
      stack.teamId,
      JSON.stringify(grant),
    ],
    { cwd: BACKEND_DIR, timeout: 10_000 },
  )

  return { state, code }
}

// A Trello grant staged before its access was kept stays private to the member who connected
// it when completed, even though the team shares new connections by default.
export async function stagedGrantFlow(
  stack: Flow & Pick<Stack, 'mongoUri'>,
  log: (line: string) => void = () => {},
) {
  const owner = client(stack.apiUrl, stack.token)
  const { member } = await joinAsAdmin(stack, owner)
  const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
  const ownerId = me.user?.id ?? me.id ?? ''
  const shareDefault = `/teams/${stack.teamId}/binding-share-default`

  must(
    (await owner('PUT', shareDefault, { share: 'team' })).status === 200,
    'the team default to change',
  )
  try {
    const { state, code } = stageLegacyTrelloGrant(stack, ownerId)
    const done = await owner('POST', `/teams/${stack.teamId}/connector-oauth/${state}/complete`, {
      code,
    })

    must(done.status === 200, `the grant to complete, got ${String(done.status)} ${done.text}`)
    const path = `/teams/${stack.teamId}/trello-integrations`
    const listed = (await owner('GET', path)).body as {
      integrations: { id: string; memberId: string }[]
    }
    const bindingId = listed.integrations.find((b) => b.memberId === `trello-${state}`)?.id

    must(Boolean(bindingId), 'the staged Trello connection to be listed')
    const access = (await owner('GET', `${path}/${bindingId!}/access`)).body as {
      memberAllowList: string[]
    }

    must(
      JSON.stringify(access.memberAllowList) === JSON.stringify([ownerId]),
      `the Trello connection to stay private, got ${JSON.stringify(access.memberAllowList)}`,
    )
    const offered = JSON.stringify(
      (await member('GET', `/agent/credential-options?teamId=${stack.teamId}`)).body,
    ).includes(bindingId!)

    must(!offered, 'the other admin not to be offered the private Trello connection')
    log('a legacy staged Trello grant completed private under a shared team default')
  } finally {
    await owner('PUT', shareDefault, { share: 'private' })
  }
}

export const stagedGrantScenarios: Scenario[] = [
  {
    name: 'a staged Trello grant without a kept list completes private under a shared default',
    run: async (_page, stack) => stagedGrantFlow(stack),
  },
]
