// Scenarios about who may use a binding, through the real routes and access checks.
import { createServer } from 'node:http'

import { freePorts, until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

type Reply = { status: number; body: unknown; text: string }

function client(apiUrl: string, token: string) {
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

function must(condition: boolean, what: string): void {
  if (!condition) throw new Error(`Expected ${what}`)
}

/** A GitLab instance answering only the code exchange and who the token belongs to; always one account. */
async function startFixtureGitlab(): Promise<{ url: string; close: () => void }> {
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
        JSON.stringify({ id: 4242, username: 'fixture-owner', name: 'Fixture Owner', email: null }),
      )

      return
    }
    response.statusCode = 404
    response.end('{}')
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))

  return { url: `http://127.0.0.1:${String(port)}`, close: () => server.close() }
}

type Flow = Pick<Stack, 'apiUrl' | 'token' | 'teamId' | 'signInCode'>

// An OAuth-connected GitLab binding starts private to the member who connects it. Another admin
// can't select it, fetch its token or re-authorize it; the member who connected it can.
export async function privateOAuthBindingFlow(stack: Flow, log: (line: string) => void = () => {}) {
  const owner = client(stack.apiUrl, stack.token)
  const gitlab = await startFixtureGitlab()

  try {
    // A second member, made an admin: admins may use shared bindings, never a private one.
    const email = `e2e-member-${String(Date.now())}@example.com`
    const anonymous = client(stack.apiUrl, '')

    await anonymous('POST', '/auth/email/request-code', { email })
    await until('the member sign-in code to be logged', async () => stack.signInCode(email))
    const verified = await anonymous('POST', '/auth/email/verify-code', {
      email,
      code: stack.signInCode(email),
    })
    const member = client(stack.apiUrl, (verified.body as { token: string }).token)
    const invited = await owner('POST', `/teams/${stack.teamId}/invitations`, {
      inviteeEmail: email,
    })
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
    log(`member ${memberId} joined as an admin`)

    // The owner connects GitLab through OAuth, without a share choice.
    const connect = async (as: ReturnType<typeof client>, code: string) => {
      const started = await as('POST', `/teams/${stack.teamId}/gitlab-bindings/start-oauth`, {
        hostUrl: gitlab.url,
        clientId: 'e2e-gitlab-client',
        clientSecret: 'e2e-gitlab-secret-not-a-production-credential',
      })

      must(started.status === 200, `start-oauth to answer 200, got ${String(started.status)}`)
      const { state } = started.body as { state: string }

      return fetch(`${stack.apiUrl}/gitlab-app/setup?state=${state}&code=${code}`, {
        redirect: 'manual',
      }).then(async (r) => ({ status: r.status, text: await r.text() }))
    }
    const first = await connect(owner, 'owner-code')

    must(first.status === 200, `the owner's callback to succeed, got ${String(first.status)}`)
    log(`owner connects GitLab: callback ${String(first.status)}`)
    const listed = await owner('GET', `/teams/${stack.teamId}/gitlab-bindings`)
    const bindings = listed.body as { bindings?: { id: string }[]; accounts?: { id: string }[] }
    const binding = (bindings.bindings ?? bindings.accounts ?? [])[0]

    must(Boolean(binding), 'the owner to see the new binding')
    const bindingId = binding!.id
    const access = async () =>
      (await owner('GET', `/teams/${stack.teamId}/gitlab-bindings/${bindingId}/access`)).body
    const before = JSON.stringify(await access())

    log(`binding ${bindingId} access: ${before}`)
    must(
      before.includes('"memberAllowList":["') && !before.includes('"*"'),
      'the binding to start private',
    )

    // Offered to a session: credential options list it for the owner only.
    const offered = async (as: ReturnType<typeof client>) =>
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

export const bindingAccessScenarios: Scenario[] = [
  {
    name: 'a private OAuth binding is usable and re-authorizable only by its owner',
    run: async (_page, stack) => privateOAuthBindingFlow(stack),
  },
]
