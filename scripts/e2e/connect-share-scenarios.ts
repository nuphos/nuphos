// Scenarios about the share choice a member makes when connecting a token connector.
import { createServer } from 'node:http'

import { client, joinAsAdmin, must } from './binding-access-scenarios.ts'
import { freePorts } from './processes.ts'

import type { Flow } from './binding-access-scenarios.ts'
import type { Scenario } from './ui.ts'

/** A SonarQube server answering only the token check a connection makes. */
async function startFixtureSonarqube(): Promise<{ url: string; close: () => void }> {
  const [port] = await freePorts(1)
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/api/authentication/validate')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ valid: true }))

      return
    }
    response.end(request.url?.startsWith('/api/server/version') ? '10.6.0' : '')
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))

  return { url: `http://127.0.0.1:${String(port)}`, close: () => server.close() }
}

// The share choice made when connecting a token connector decides who can use the new binding.
export async function connectShareFlow(stack: Flow, log: (line: string) => void = () => {}) {
  const owner = client(stack.apiUrl, stack.token)
  const sonarqube = await startFixtureSonarqube()

  try {
    const { member, memberId } = await joinAsAdmin(stack, owner)
    const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
    const ownerId = me.user?.id ?? me.id ?? ''
    const connect = async (label: string, share?: unknown) => {
      const bound = await owner('POST', `/teams/${stack.teamId}/sonarqube-integrations`, {
        label,
        baseUrl: sonarqube.url,
        token: 'squ_fixture',
        ...(share !== undefined && { share }),
      })

      must(bound.status < 300, `${label} to connect, got ${String(bound.status)} ${bound.text}`)
      const id = (bound.body as { id?: string; integration?: { id: string } }).integration?.id
      const listed = (await owner('GET', `/teams/${stack.teamId}/sonarqube-integrations`)).body as {
        integrations: { id: string; label: string }[]
      }
      const bindingId = id ?? listed.integrations.find((b) => b.label === label)!.id
      const access = (
        await owner('GET', `/teams/${stack.teamId}/sonarqube-integrations/${bindingId}/access`)
      ).body as { memberAllowList: string[] }

      // Whether the other admin can use it: offered to their sessions, and its route answers.
      const offered = JSON.stringify(
        (await member('GET', `/agent/credential-options?teamId=${stack.teamId}`)).body,
      ).includes(bindingId)
      const opened = await member(
        'GET',
        `/teams/${stack.teamId}/sonarqube-integrations/${bindingId}`,
      )
      const usable = offered && opened.status === 200

      must(usable || (!offered && opened.status === 403), `${label}: offered and access to agree`)
      log(
        `${label}: ${JSON.stringify(access.memberAllowList)}, other admin can use it: ${String(usable)}`,
      )

      return { list: [...access.memberAllowList].sort(), usable }
    }
    const same = (got: { list: string[] }, b: string[]) =>
      JSON.stringify(got.list) === JSON.stringify([...b].sort())

    const onlyMe = await connect('only me', { mode: 'private' })

    must(same(onlyMe, [ownerId]) && !onlyMe.usable, 'only me to stay private to the owner')
    const team = await connect('the team', { mode: 'team' })

    must(same(team, ['*']) && team.usable, 'the team to let every member use it')
    const chosen = await connect('chosen members', { mode: 'members', memberIds: [memberId] })

    must(same(chosen, [ownerId, memberId]) && chosen.usable, 'chosen members to be able to use it')
    must(
      same(await connect('no choice, private default'), [ownerId]),
      'no choice to follow a private default',
    )
    must(
      (await owner('PUT', `/teams/${stack.teamId}/binding-share-default`, { share: 'team' }))
        .status === 200,
      'the team default to change',
    )
    must(
      same(await connect('no choice, team default'), ['*']),
      'no choice to follow a shared default',
    )
    await owner('PUT', `/teams/${stack.teamId}/binding-share-default`, { share: 'private' })
  } finally {
    sonarqube.close()
  }
}

export const connectShareScenarios: Scenario[] = [
  {
    name: 'the share choice made when connecting decides who can use the new binding',
    run: async (_page, stack) => connectShareFlow(stack),
  },
]
