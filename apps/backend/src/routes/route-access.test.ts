import { describe, expect, test } from 'bun:test'

import { useIdentity } from '@/lib/test/doubles/identity'

import declared from './route-access.json'

/**
 * Every route the app serves is declared in route-access.json with who may call
 * it: `public`, any signed-in `user`, or a team `member` / `editor` / `admin`.
 * A new route fails here until it is declared, and a declared route fails when
 * its gate no longer matches.
 *
 * Team levels are read off the `requireTeamRole` gates the router matches for
 * the route, so they reflect what is enforced before the handler runs; checks
 * a handler makes on its own are not visible here.
 */
type Access = 'public' | 'user' | 'member' | 'editor' | 'admin'

const OUTSIDER = '64b5f1c2e4b0a1d2c3e4f5aa'
const ID = '64b5f1c2e4b0a1d2c3e4f501'

useIdentity({
  authenticateToken: async (token: string) =>
    token === 'outsider'
      ? ({ user: { id: OUTSIDER, email: 'outsider@example.com', name: 'Outsider' } } as never)
      : null,
  getTeamMembership: async () => null,
})

const { app } = await import('@/index-app')

const table = declared as Record<string, Access>
const endpoints = [
  ...new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`)),
].sort((a, b) => a.localeCompare(b))

/** A path the route matches: ids for params (regex ones get a matching value). */
function concrete(path: string): string {
  return path
    .replace(/:file\{[^}]*\}\}/, '0a')
    .replace(/:version\{[^}]*\}\}/, '0123456789ab')
    .replace(/:\w+(\{[^}]*\})?\??/g, ID)
    .replace(/\*/g, 'x')
}

type Matched = [[[unknown, unknown], unknown][]]

/** The team level the router's role gates enforce for this route. */
function enforcedTeamLevel(method: string, path: string): Access {
  const [handlers] = app.router.match(method, concrete(path)) as unknown as Matched
  let allowed = ['ADMINISTRATOR', 'EDITOR', 'VIEWER']

  for (const [[handler]] of handlers) {
    const roles = (handler as { teamRoles?: readonly string[] }).teamRoles

    if (roles) allowed = allowed.filter((role) => roles.includes(role))
  }
  if (allowed.includes('VIEWER')) return 'member'

  return allowed.includes('EDITOR') ? 'editor' : 'admin'
}

const split = (key: string) => key.split(' ') as [string, string]
const teamRoutes = endpoints.filter((key) => split(key)[1].startsWith('/teams/:teamId'))
const signedIn = endpoints.filter((key) => table[key] && table[key] !== 'public')

describe('route access table', () => {
  test('declares every route the app serves, and nothing else', () => {
    const undeclared = endpoints.filter((key) => !(key in table))
    const stale = Object.keys(table).filter((key) => !endpoints.includes(key))

    expect(undeclared).toEqual([])
    expect(stale).toEqual([])
  })

  test('team routes are declared at the level their role gates enforce', () => {
    const mismatched = teamRoutes
      .filter((key) => key in table)
      .map((key) => ({ key, declared: table[key], enforced: enforcedTeamLevel(...split(key)) }))
      .filter((row) => row.declared !== row.enforced)

    expect(mismatched).toEqual([])
  })

  test('every non-public route refuses a request without a token', async () => {
    const answered: string[] = []

    for (const key of signedIn) {
      const [method, path] = split(key)
      const res = await app.request(concrete(path), { method })

      if (res.status !== 401) answered.push(`${key} → ${String(res.status)}`)
    }
    expect(answered).toEqual([])
  })

  test('every team route refuses a signed-in user from another team', async () => {
    const answered: string[] = []

    for (const key of teamRoutes) {
      const [method, path] = split(key)
      const res = await app.request(concrete(path), {
        method,
        headers: { Authorization: 'Bearer outsider' },
      })

      if (res.status !== 403) answered.push(`${key} → ${String(res.status)}`)
    }
    expect(answered).toEqual([])
  })
})
