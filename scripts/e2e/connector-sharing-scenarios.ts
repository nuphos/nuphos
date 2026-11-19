import { createServer } from 'node:http'

import { client, joinAsAdmin, must } from './binding-access-scenarios.ts'
import { freePorts } from './processes.ts'

import type { Flow } from './binding-access-scenarios.ts'

/** Real backend authorization; only the external token-validation provider is a fixture. */
export async function connectorSharingFlow(stack: Flow) {
  const admin = client(stack.apiUrl, stack.token)
  const editor = await joinAsAdmin(stack, admin)
  const viewer = await joinAsAdmin(stack, admin)
  must(
    (await admin('PATCH', `/teams/${stack.teamId}/members/${viewer.memberId}`, { role: 'VIEWER' }))
      .status === 200,
    'viewer role',
  )
  const [port] = await freePorts(1)
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(req.url?.startsWith('/api/authentication/validate') ? '{"valid":true}' : '10.6.0')
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  try {
    must(
      (await admin('PUT', `/teams/${stack.teamId}/binding-share-default`, { share: 'team' }))
        .status === 200,
      'legacy default set to team',
    )
    const created = await editor.member('POST', `/teams/${stack.teamId}/sonarqube-integrations`, {
      label: 'E2E private connection',
      baseUrl: `http://127.0.0.1:${port}`,
      token: 'squ_fixture',
    })
    must(created.status < 300, `connection creation: ${created.status} ${created.text}`)
    must(
      (
        await admin('PATCH', `/teams/${stack.teamId}/members/${editor.memberId}`, {
          role: 'EDITOR',
        })
      ).status === 200,
      'editor role',
    )

    const listed = (await editor.member('GET', `/teams/${stack.teamId}/sonarqube-integrations`))
      .body as { integrations: { id: string; label: string }[] }
    const id = listed.integrations.find((row) => row.label === 'E2E private connection')!.id
    const path = `/teams/${stack.teamId}/sonarqube-integrations/${id}`
    const key = `sonarqube:${id}`
    const inventory = async (as: typeof admin) =>
      (await as('GET', `/teams/${stack.teamId}/connectors`)).body as {
        sharing: Record<string, { owned: boolean; shared: boolean }>
      }
    const access = (await editor.member('GET', `${path}/access`)).body as {
      memberAllowList: string[]
    }
    must(
      JSON.stringify(access.memberAllowList) === JSON.stringify([editor.memberId]),
      'new member binding defaults to private',
    )
    must(
      !(await inventory(admin)).sharing[key],
      'admin inventory excludes another member private binding',
    )
    must(
      !(await inventory(viewer.member)).sharing[key],
      'another member inventory excludes private binding',
    )
    must((await admin('GET', path)).status === 403, 'admin cannot use private binding')
    must(
      (await editor.member('PUT', `${path}/access`, { memberAllowList: ['*'] })).status === 200,
      'owner explicitly shares',
    )
    must(
      (await inventory(editor.member)).sharing[key]?.owned,
      'owner inventory identifies ownership',
    )
    must((await inventory(admin)).sharing[key]?.shared, 'admin inventory identifies shared binding')
    must(
      (await editor.member('PUT', `${path}/access`, { memberAllowList: [editor.memberId] }))
        .status === 403,
      'shared owner cannot manage access',
    )
    must(
      (await admin('PUT', `${path}/access`, { memberAllowList: ['*'] })).status === 200,
      'admin manages shared binding',
    )
    must((await viewer.member('GET', path)).status === 403, 'viewer cannot use team share')
    must(
      !(await inventory(viewer.member)).sharing[key],
      'viewer catalog excludes unusable shared binding',
    )
    must(
      (
        await admin('PUT', `${path}/access`, {
          memberAllowList: [editor.memberId, viewer.memberId],
        })
      ).status === 200,
      'admin creates explicit member-list share',
    )
    must(
      (await viewer.member('GET', path)).status === 403,
      'viewer cannot use explicit member-list share',
    )
    must(
      (
        await admin('POST', `/teams/${stack.teamId}/sonarqube-integrations`, {
          label: 'My development connection',
          baseUrl: `http://127.0.0.1:${port}`,
          token: 'squ_fixture',
        })
      ).status < 300,
      'admin private connection for real app preview',
    )
    console.log(
      'PASS private default, inventory isolation, shared admin management, owner denial, viewer team/list denial',
    )
  } finally {
    server.close()
  }
}
