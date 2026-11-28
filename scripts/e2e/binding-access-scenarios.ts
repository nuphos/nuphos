// Scenarios about who may use a binding, through the real routes and access checks.
import { createServer } from 'node:http'

import { freePorts, until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

type Reply = { status: number; body: unknown; text: string }

export function client(apiUrl: string, token: string) {
  return async (method: string, path: string, body?: unknown): Promise<Reply> => {
    const response = await fetch(apiUrl + path, {
      method,
      redirect: 'manual',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
    const text = await response.text()

    return { status: response.status, body: parse(text), text }
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function must(condition: boolean, what: string): asserts condition {
  if (!condition) throw new Error(`Expected ${what}`)
}

/** A GitLab instance answering only the code exchange and who the token belongs to; always one account. */
export async function startFixtureGitlab(
  accountId: number,
): Promise<{ url: string; accountId: number; close: () => void }> {
  const [port] = await freePorts(1)
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.method === 'POST' && request.url?.startsWith('/oauth/token')) {
      response.end(
        JSON.stringify({
          access_token: `glpat-fixture-${String(Date.now())}`,
          refresh_token: 'fixture-refresh',
          token_type: 'Bearer',
          expires_in: 7200,
          created_at: Math.floor(Date.now() / 1000),
          scope: 'api',
        }),
      )

      return
    }
    if (request.url?.startsWith('/api/v4/user')) {
      response.end(
        JSON.stringify({
          id: accountId,
          username: 'fixture-owner',
          name: 'Fixture Owner',
          email: null,
        }),
      )

      return
    }
    response.statusCode = 404
    response.end('{}')
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))

  return { url: `http://127.0.0.1:${String(port)}`, accountId, close: () => server.close() }
}

export type Flow = Pick<Stack, 'apiUrl' | 'token' | 'teamId' | 'signInCode'>

export type Client = ReturnType<typeof client>

/** Signs a second member in and makes them an admin: admins may use shared bindings, never a private one. */
export async function joinAsAdmin(
  stack: Flow,
  owner: Client,
): Promise<{ member: Client; memberId: string; token: string }> {
  const email = `e2e-member-${String(Date.now())}@example.com`
  const anonymous = client(stack.apiUrl, '')

  await anonymous('POST', '/auth/email/request-code', { email })
  await until('the member sign-in code to be logged', async () => stack.signInCode(email))
  const verified = await anonymous('POST', '/auth/email/verify-code', {
    email,
    code: stack.signInCode(email),
  })
  const { token } = verified.body as { token: string }
  const member = client(stack.apiUrl, token)
  const invited = await owner('POST', `/teams/${stack.teamId}/invitations`, { inviteeEmail: email })
  const invitationId = (invited.body as { invitation: { id: string } }).invitation.id

  must(
    (await member('POST', `/invitations/${invitationId}/accept`)).status === 200,
    'the invitation to be accepted',
  )
  const me = (await member('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
  const memberId = me.user?.id ?? me.id ?? ''
  const promoted = await owner('PATCH', `/teams/${stack.teamId}/members/${memberId}`, {
    role: 'ADMINISTRATOR',
  })

  must(promoted.status === 200, `the member to become an admin, got ${String(promoted.status)}`)

  return { member, memberId, token }
}

/** Connects the fixture GitLab account through OAuth, without a share choice. */
export async function connectGitlab(stack: Flow, as: Client, hostUrl: string, code: string) {
  const started = await as('POST', `/teams/${stack.teamId}/gitlab-bindings/start-oauth`, {
    hostUrl,
    clientId: 'e2e-gitlab-client',
    clientSecret: 'e2e-gitlab-secret-not-a-production-credential',
  })

  must(started.status === 200, `start-oauth to answer 200, got ${String(started.status)}`)
  const { state } = started.body as { state: string }
  const response = await fetch(`${stack.apiUrl}/gitlab-app/setup?state=${state}&code=${code}`, {
    redirect: 'manual',
  })

  return { status: response.status, text: await response.text() }
}

/** The team's binding for `gitlab`: a fixture can reuse a closed one's port, so the address alone may match another. */
export async function gitlabBindingId(
  stack: Flow,
  owner: Client,
  gitlab: { url: string; accountId: number },
): Promise<string> {
  const listed = (await owner('GET', `/teams/${stack.teamId}/gitlab-bindings`)).body as {
    bindings?: { id: string; hostUrl?: string; accountId?: number }[]
    accounts?: { id: string; hostUrl?: string; accountId?: number }[]
  }
  const binding = (listed.bindings ?? listed.accounts ?? []).find(
    (b) => b.hostUrl === gitlab.url && b.accountId === gitlab.accountId,
  )

  must(Boolean(binding), 'the owner to see the new binding')

  return binding!.id
}

// An OAuth-connected GitLab binding starts private to the member who connects it. Another admin
// can't select it, fetch its token or re-authorize it; the member who connected it can.
export async function privateOAuthBindingFlow(stack: Flow, log: (line: string) => void = () => {}) {
  const owner = client(stack.apiUrl, stack.token)
  const gitlab = await startFixtureGitlab(4242)

  try {
    const { member, memberId } = await joinAsAdmin(stack, owner)
    const connect = async (as: Client, code: string) => connectGitlab(stack, as, gitlab.url, code)

    log(`member ${memberId} joined as an admin`)
    const first = await connect(owner, 'owner-code')

    must(first.status === 200, `the owner's callback to succeed, got ${String(first.status)}`)
    log(`owner connects GitLab: callback ${String(first.status)}`)
    const bindingId = await gitlabBindingId(stack, owner, gitlab)
    const access = async () =>
      (await owner('GET', `/teams/${stack.teamId}/gitlab-bindings/${bindingId}/access`)).body
    const before = JSON.stringify(await access())

    log(`binding ${bindingId} access: ${before}`)
    must(
      before.includes('"memberAllowList":["') && !before.includes('"*"'),
      'the binding to start private',
    )

    // Offered to a session: credential options list it for the owner only.
    const offered = async (as: Client) =>
      JSON.stringify(
        (await as('GET', `/agent/credential-options?teamId=${stack.teamId}`)).body,
      ).includes(bindingId)

    must(await offered(owner), 'the owner to be offered the binding')
    must(!(await offered(member)), 'the other admin not to be offered it')
    log('credential options: offered to the owner, not to the other admin')

    // Fetching its token.
    const ownerToken = await owner(
      'GET',
      `/teams/${stack.teamId}/gitlab-bindings/${bindingId}/token`,
    )
    const memberToken = await member(
      'GET',
      `/teams/${stack.teamId}/gitlab-bindings/${bindingId}/token`,
    )

    log(
      `token: owner ${String(ownerToken.status)}, other admin ${String(memberToken.status)} ${memberToken.text.slice(0, 160)}`,
    )
    must(ownerToken.status === 200, 'the owner to get its token')
    must(memberToken.status === 403, 'the other admin to be refused its token')

    // Re-authorizing the same GitLab account.
    const rebindByMember = await connect(member, 'member-code')

    log(
      `other admin re-authorizes: ${String(rebindByMember.status)} ${rebindByMember.text.slice(0, 200)}`,
    )
    must(rebindByMember.status === 403, 'the other admin to be refused re-authorizing it')
    must(
      JSON.stringify(await access()) === before,
      'the list to be unchanged after the refused re-authorization',
    )
    must(
      (await member('GET', `/teams/${stack.teamId}/gitlab-bindings/${bindingId}/token`)).status ===
        403,
      'the other admin still to be refused after re-authorizing',
    )
    const rebindByOwner = await connect(owner, 'owner-code-2')

    must(
      rebindByOwner.status === 200,
      `the owner to re-authorize it, got ${String(rebindByOwner.status)}`,
    )
    log(`owner re-authorizes: callback ${String(rebindByOwner.status)}`)
    must(
      JSON.stringify(await access()) === before,
      'the list to be unchanged after the owner re-authorizes',
    )
    must(
      (await owner('GET', `/teams/${stack.teamId}/gitlab-bindings/${bindingId}/token`)).status ===
        200,
      'the owner still to get its token',
    )
    log('list unchanged after both re-authorizations')
  } finally {
    gitlab.close()
  }
}

// Its owner shares a private binding and takes it back; another admin can't change its list.
export async function bindingListFlow(stack: Flow, log: (line: string) => void = () => {}) {
  const owner = client(stack.apiUrl, stack.token)
  const gitlab = await startFixtureGitlab(4343)

  try {
    const { member, memberId } = await joinAsAdmin(stack, owner)

    must(
      (await connectGitlab(stack, owner, gitlab.url, 'list-code')).status === 200,
      'GitLab to connect',
    )
    const bindingId = await gitlabBindingId(stack, owner, gitlab)
    const path = `/teams/${stack.teamId}/gitlab-bindings/${bindingId}`
    const save = async (as: Client, memberAllowList: string[]) =>
      (await as('PUT', `${path}/access`, { memberAllowList })).status
    const token = async (as: Client) => (await as('GET', `${path}/token`)).status
    const ownerId = ((await owner('GET', `${path}/access`)).body as { memberAllowList: string[] })
      .memberAllowList[0]!

    const refused = await save(member, ['*'])

    log(`other admin shares the private binding: ${String(refused)}`)
    must(refused === 403, 'another admin to be refused changing a private list')

    must((await save(owner, [ownerId, memberId])) === 200, 'the owner to share it')
    log(`owner shares it with the other admin: their token ${String(await token(member))}`)
    must((await token(member)) === 200, 'the other admin to use it once shared')

    must((await save(owner, [ownerId])) === 200, 'the owner to take it back')
    log(`owner takes it back: their token ${String(await token(member))}`)
    must((await token(member)) === 403, 'the other admin to be refused once it is private again')

    // The Desktop refuses to save an empty list; the backend keeps the owner able to reopen one.
    must((await save(owner, [])) === 200, 'the owner to empty it')
    must((await token(owner)) === 403, 'nobody to use an empty list')
    must((await save(owner, [ownerId])) === 200, 'the owner to reopen it')
    must((await token(owner)) === 200, 'the owner to use it again')
    log('owner empties the list and reopens it')
  } finally {
    gitlab.close()
  }
}

export const bindingAccessScenarios: Scenario[] = [
  {
    name: 'a private OAuth binding is usable and re-authorizable only by its owner',
    run: async (_page, stack) => privateOAuthBindingFlow(stack),
  },
  {
    name: "a private binding's list is changed only by its owner",
    run: async (_page, stack) => bindingListFlow(stack),
  },
]
