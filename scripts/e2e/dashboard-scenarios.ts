// Scenarios about who sees a dashboard (#2988), run against the real backend through
// its API: three members of one team, signed in with email codes.
import { until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

type Member = { email: string; token: string; id: string }

/** The fields these scenarios read from the backend's answers. */
type Answer = {
  token?: string
  id?: string
  invitation?: { id: string }
  members?: { id: string; email: string }[]
  dashboards?: { id: string }[]
  formerMembers?: { id: string }[]
}

function api(stack: Stack, token: string) {
  return async (method: string, path: string, body?: unknown) => {
    const response = await fetch(stack.apiUrl + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()

    return { status: response.status, body: text ? (JSON.parse(text) as Answer) : ({} as Answer) }
  }
}

/** Signs a new person in with an email code and has the team's owner invite them in. */
async function joinTeam(stack: Stack, name: string): Promise<Member> {
  const email = `e2e-${name}-${String(Date.now())}@example.com`
  const anonymous = api(stack, '')

  await anonymous('POST', '/auth/email/request-code', { email })
  await until(`${name}'s sign-in code to be logged`, async () => stack.signInCode(email))
  const signedIn = await anonymous('POST', '/auth/email/verify-code', {
    email,
    code: stack.signInCode(email),
  })
  const token = String(signedIn.body.token)
  const owner = api(stack, stack.token)
  const invited = await owner('POST', `/teams/${stack.teamId}/invitations`, {
    inviteeEmail: email,
  })
  const accepted = await api(stack, token)(
    'POST',
    `/invitations/${String(invited.body.invitation?.id)}/accept`,
  )

  if (accepted.status >= 300) throw new Error(`${name} could not join: ${accepted.status}`)
  const members = await owner('GET', `/teams/${stack.teamId}/members`)
  const id = (members.body.members ?? []).find((member) => member.email === email)?.id

  if (!id) throw new Error(`${name} is not listed as a member`)

  return { email, token, id }
}

function expectStatus(label: string, actual: number, expected: number) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`)
}

const range = {
  periodStart: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  periodEnd: new Date().toISOString(),
}

/** Creates a personal dashboard with one panel, as `member`. */
async function personalDashboard(stack: Stack, member: Member, name: string) {
  const as = api(stack, member.token)
  const created = await as('POST', `/teams/${stack.teamId}/dashboards`, {
    name,
    timeRange: range,
    visibility: 'personal',
  })

  expectStatus(`${name} created`, created.status, 201)
  const id = String(created.body.id)
  const panel = await as('POST', `/teams/${stack.teamId}/dashboards/${id}/panels`, {
    title: 'Spend',
    kind: 'scalar',
    code: 'export default async () => ({ kind: "scalar", title: "Spend", value: 1 })',
  })

  expectStatus(`${name}'s panel created`, panel.status, 201)

  return { id, panelId: String(panel.body.id) }
}

export const dashboardScenarios: Scenario[] = [
  {
    name: 'a personal dashboard stays its creator’s until shared, and an Administrator takes it over once they leave',
    run: async (_page, stack) => {
      const a = await joinTeam(stack, 'creator')
      const b = await joinTeam(stack, 'teammate')
      // The team's owner, who created it, is its Administrator.
      const admin = api(stack, stack.token)
      const team = `/teams/${stack.teamId}/dashboards`
      const mine = await personalDashboard(stack, a, 'Personal E2E')
      const paths = {
        dashboard: `${team}/${mine.id}`,
        snapshots: `${team}/${mine.id}/panels/${mine.panelId}/snapshots`,
        alert: `${team}/${mine.id}/panels/${mine.panelId}/alert`,
      }

      // Its creator reads it, its snapshot and its alert.
      for (const [what, path] of Object.entries(paths)) {
        expectStatus(
          `creator reads the ${what}`,
          (await api(stack, a.token)('GET', path)).status,
          200,
        )
      }
      // A teammate and the Administrator get 404 on all three while the creator is in the team.
      for (const [who, as] of [
        ['teammate', api(stack, b.token)],
        ['Administrator', admin],
      ] as const) {
        for (const [what, path] of Object.entries(paths)) {
          expectStatus(`${who} reads the ${what}`, (await as('GET', path)).status, 404)
        }
        const listed = await as('GET', team)
        const ids = [...(listed.body.dashboards ?? []), ...(listed.body.formerMembers ?? [])].map(
          (d: { id: string }) => d.id,
        )

        if (ids.includes(mine.id)) throw new Error(`${who} lists the creator's personal dashboard`)
      }
      expectStatus('Administrator deletes it', (await admin('DELETE', paths.dashboard)).status, 404)

      // Shared with the team, the teammate reads it.
      const shared = await api(stack, a.token)('PUT', paths.dashboard, { visibility: 'team' })

      expectStatus('creator shares it', shared.status, 200)
      expectStatus(
        'teammate reads it once shared',
        (await api(stack, b.token)('GET', paths.dashboard)).status,
        200,
      )

      // Once its creator is no longer in the team, the Administrator takes a personal one over.
      const left = await personalDashboard(stack, a, 'Left behind E2E')
      const leftPath = `${team}/${left.id}`

      expectStatus(
        'creator removed from the team',
        (await admin('DELETE', `/teams/${stack.teamId}/members/${a.id}`)).status,
        204,
      )
      const listed = await admin('GET', team)

      if (!(listed.body.formerMembers ?? []).some((d) => d.id === left.id)) {
        throw new Error('the Administrator does not list the personal dashboard left behind')
      }
      expectStatus('Administrator opens it', (await admin('GET', leftPath)).status, 200)
      expectStatus(
        'teammate still cannot read it',
        (await api(stack, b.token)('GET', leftPath)).status,
        404,
      )
      expectStatus(
        'Administrator moves it to Team',
        (await admin('PUT', leftPath, { visibility: 'team' })).status,
        200,
      )
      expectStatus(
        'teammate reads it once moved to Team',
        (await api(stack, b.token)('GET', leftPath)).status,
        200,
      )
    },
  },
]
