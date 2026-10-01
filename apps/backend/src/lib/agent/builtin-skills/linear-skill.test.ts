import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { getBuiltinSkillsDirectory } from '@/lib/agent/skill-store/inject'

const linearDir = path.join(getBuiltinSkillsDirectory(), 'linear')
const scriptsDir = path.join(linearDir, 'scripts')

let server: ReturnType<typeof Bun.serve>
let testScriptsRoot: string
let testScriptsDir: string
let largeDirectory = false
let requests: Array<{ authorization: string | null; body: Record<string, unknown> }> = []

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        query?: string
        variables?: {
          input?: Record<string, unknown>
          after?: string
          id?: string
          filter?: { or?: Array<Record<string, { containsIgnoreCase: string }>> }
        }
      }

      requests.push({ authorization: request.headers.get('authorization'), body })
      if (body.query?.includes('query IssueContext')) {
        const teams = [
          { id: 'team-pla', key: 'PLA', name: 'Platform' },
          { id: 'team-eng', key: 'ENG', name: 'Engineering' },
        ]
        const users = [
          {
            id: 'user-matthew',
            name: 'Matthew Lee',
            displayName: 'matthewlee',
            email: 'matthew@example.com',
            active: true,
          },
          {
            id: 'user-jane',
            name: 'Jane Lee',
            displayName: 'jane',
            email: 'jane@example.com',
            active: true,
          },
        ]
        if (largeDirectory) {
          users.push(
            ...Array.from({ length: 250 }, (_, index) => ({
              id: `user-extra-${index}`,
              name: `Extra ${index}`,
              displayName: `extra${index}`,
              email: `extra${index}@example.com`,
              active: true,
            })),
          )
        }
        const page = (nodes: unknown[]) => {
          const offset = Number(body.variables?.after ?? 0)
          const size = largeDirectory ? 100 : 1
          return {
            nodes: nodes.slice(offset, offset + size),
            pageInfo: {
              hasNextPage: offset + size < nodes.length,
              endCursor: String(offset + size),
            },
          }
        }
        if (body.query.includes('IssueContextUsers')) {
          // Reject the nested fan-out that exceeded Linear's complexity budget.
          if (body.query.includes('teams(')) {
            return Response.json({ errors: [{ message: 'Query too complex' }] }, { status: 400 })
          }
          const filters = body.variables?.filter?.or
          const matched = users.filter(
            (user) =>
              !filters ||
              filters.some((filter) =>
                Object.entries(filter).some(([field, value]) =>
                  String(user[field as keyof typeof user])
                    .toLowerCase()
                    .includes(value.containsIgnoreCase.toLowerCase()),
                ),
              ),
          )
          return Response.json({ data: { users: page(matched) } })
        }
        if (body.query.includes('IssueContextMemberships')) {
          return Response.json({ data: { user: { teams: page(teams) } } })
        }
        if (body.query.includes('IssueContextTeams')) {
          return Response.json({ data: { teams: page(teams) } })
        }
        return Response.json({ data: { viewer: { id: 'viewer-1', name: 'Nuphos' } } })
      }
      if (body.query?.includes('mutation CreateAttachment')) {
        return Response.json({
          data: {
            attachmentCreate: {
              success: true,
              attachment: {
                id: 'attachment-1',
                title: 'Nuphos session',
                subtitle: 'Source context',
                url: body.variables?.input?.url,
              },
            },
          },
        })
      }

      return Response.json({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: 'issue-1',
              identifier: 'PLA-1',
              title: body.variables?.input?.title,
              url: 'https://linear.app/example/PLA-1',
              priority: 0,
              state: { id: 'state-default', name: 'Backlog', type: 'backlog' },
              assignee: {
                id: 'user-matthew',
                name: 'Matthew Lee',
                displayName: 'matthewlee',
                email: 'matthew@example.com',
              },
              team: { id: 'team-pla', key: 'PLA', name: 'Platform' },
            },
          },
        },
      })
    },
  })
  testScriptsRoot = await mkdtemp(path.join(os.tmpdir(), 'linear-skill-scripts-'))
  testScriptsDir = path.join(testScriptsRoot, 'scripts')
  await mkdir(testScriptsDir)
  for (const script of ['issue-context.sh', 'issue-create.sh']) {
    await copyFile(path.join(scriptsDir, script), path.join(testScriptsDir, script))
    await chmod(path.join(testScriptsDir, script), 0o755)
  }
  await writeFile(
    path.join(testScriptsDir, 'graphql.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
source "\${LINEAR_ENV_PATH:-$HOME/.linear/nuphos.env}"
/usr/bin/curl -fsS \
  -H "Authorization: Bearer \${LINEAR_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary "@\${1:--}" \
  "\${LINEAR_TEST_GRAPHQL_URL:?test endpoint missing}"
`,
  )
  await chmod(path.join(testScriptsDir, 'graphql.sh'), 0o755)
})

afterAll(async () => {
  server.stop(true)
  await rm(testScriptsRoot, { recursive: true, force: true })
})

async function testHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'linear-skill-'))
  const linear = path.join(home, '.linear')

  await mkdir(linear)
  await writeFile(
    path.join(linear, 'nuphos.env'),
    "export LINEAR_ACCESS_TOKEN='test-token'\nexport LINEAR_NUPHOS_TEAM_ID='nuphos-team'\n",
  )
  await chmod(path.join(linear, 'nuphos.env'), 0o600)

  return home
}

function spawnEnv(home: string): Record<string, string> {
  return {
    ...process.env,
    HOME: home,
    LINEAR_TEST_GRAPHQL_URL: server.url.toString(),
    NUPHOS_SESSION_ID: 'session-123',
  } as Record<string, string>
}

describe('linear skill stateless helpers', () => {
  test('filters users on the server and paginates teams and memberships', async () => {
    const home = await testHome()
    requests = []
    try {
      const process = Bun.spawn(
        ['bash', path.join(testScriptsDir, 'issue-context.sh'), 'matthew|matt'],
        { env: spawnEnv(home), stdout: 'pipe', stderr: 'pipe' },
      )
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])

      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      expect(JSON.parse(stdout)).toMatchObject({
        userSearchMatched: true,
        teams: [
          { id: 'team-pla', key: 'PLA' },
          { id: 'team-eng', key: 'ENG' },
        ],
        users: [
          {
            id: 'user-matthew',
            name: 'Matthew Lee',
            teams: { nodes: [{ id: 'team-pla' }, { id: 'team-eng' }] },
          },
        ],
      })
      expect(requests).toHaveLength(6)
      expect(requests.every((request) => request.authorization === 'Bearer test-token')).toBe(true)
      expect(requests[0]?.body).toMatchObject({
        variables: {
          filter: {
            active: { eq: true },
            or: [
              { name: { containsIgnoreCase: 'matthew' } },
              { displayName: { containsIgnoreCase: 'matthew' } },
              { email: { containsIgnoreCase: 'matthew' } },
              { name: { containsIgnoreCase: 'matt' } },
              { displayName: { containsIgnoreCase: 'matt' } },
              { email: { containsIgnoreCase: 'matt' } },
            ],
          },
        },
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test.each([
    ['nobody-matches', false],
    ['', true],
    ['LEE', true],
    ['  matthew@example.com | nobody  ', true],
  ])('paginates users and preserves fallback for %s', async (search, matched) => {
    const home = await testHome()
    requests = []
    try {
      const process = Bun.spawn(['bash', path.join(testScriptsDir, 'issue-context.sh'), search], {
        env: spawnEnv(home),
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])
      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      const result = JSON.parse(stdout)
      expect(result.userSearchMatched).toBe(matched)
      expect(result.users.map((user: { id: string }) => user.id)).toEqual(
        search.includes('@') ? ['user-matthew'] : ['user-matthew', 'user-jane'],
      )
      if (search.includes('@')) {
        expect(result.users[0].teams.nodes).toHaveLength(2)
      } else {
        expect(result.users.every((user: { teams: unknown }) => user.teams === null)).toBe(true)
        expect(
          requests.some((request) =>
            String(request.body.query).includes('IssueContextMemberships'),
          ),
        ).toBe(false)
      }
      if (!search.includes('@')) {
        expect(
          requests.some(
            (request) =>
              String(request.body.query).includes('IssueContextUsers') &&
              (request.body.variables as { after?: string }).after === '1',
          ),
        ).toBe(true)
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test('does not expand memberships for a large fallback directory', async () => {
    const home = await testHome()
    requests = []
    largeDirectory = true
    try {
      const process = Bun.spawn(
        ['bash', path.join(testScriptsDir, 'issue-context.sh'), 'no-such-member'],
        { env: spawnEnv(home), stdout: 'pipe', stderr: 'pipe' },
      )
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])
      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      const result = JSON.parse(stdout)
      expect(result.users).toHaveLength(252)
      expect(result.userSearchMatched).toBe(false)
      expect(requests).toHaveLength(6)
      expect(
        requests.some((request) => String(request.body.query).includes('IssueContextMemberships')),
      ).toBe(false)
    } finally {
      largeDirectory = false
      await rm(home, { recursive: true, force: true })
    }
  })

  test('rejects excessive aliases before making API requests', async () => {
    const home = await testHome()
    requests = []
    try {
      const process = Bun.spawn(
        [
          'bash',
          path.join(testScriptsDir, 'issue-context.sh'),
          Array.from({ length: 1000 }, (_, index) => `alias${index}`).join('|'),
        ],
        { env: spawnEnv(home), stdout: 'pipe', stderr: 'pipe' },
      )
      const [exitCode, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ])
      expect(exitCode).toBe(2)
      expect(stderr).toContain('at most 10 search aliases')
      expect(requests).toHaveLength(0)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test('creates an issue from stdin without inventing state or priority', async () => {
    const home = await testHome()
    requests = []
    try {
      const description = '## Summary\n\nPreserve this markdown.\n'
      const process = Bun.spawn(
        [
          'bash',
          path.join(testScriptsDir, 'issue-create.sh'),
          '--team',
          'team-pla',
          '--assignee',
          'user-matthew',
          '--title',
          'Fix the orphan cleanup',
        ],
        {
          env: spawnEnv(home),
          stdin: new Blob([description]),
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])

      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      expect(JSON.parse(stdout)).toMatchObject({
        identifier: 'PLA-1',
        sourceLink: {
          title: 'Nuphos session',
          url: 'https://nuphos.ai/teams/nuphos-team/agent/session-123',
        },
      })
      expect(requests).toHaveLength(2)

      expect(requests[0]?.body).toMatchObject({
        variables: {
          input: {
            teamId: 'team-pla',
            assigneeId: 'user-matthew',
            title: 'Fix the orphan cleanup',
            description,
          },
        },
      })
      const input = (requests[0]?.body.variables as { input: Record<string, unknown> }).input

      expect(input).not.toHaveProperty('stateId')
      expect(input).not.toHaveProperty('priority')
      expect(requests[1]?.body).toMatchObject({
        variables: {
          input: {
            issueId: 'issue-1',
            title: 'Nuphos session',
            subtitle: 'Source context',
            url: 'https://nuphos.ai/teams/nuphos-team/agent/session-123',
            metadata: { nuphosSessionId: 'session-123' },
          },
        },
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test('uses the native Links field even when the description already mentions the URL', async () => {
    const home = await testHome()
    requests = []
    try {
      const sessionUrl = 'https://nuphos.ai/teams/nuphos-team/agent/session-123'
      const process = Bun.spawn(
        [
          'bash',
          path.join(testScriptsDir, 'issue-create.sh'),
          '--team',
          'team-pla',
          '--title',
          'Already linked',
        ],
        {
          env: spawnEnv(home),
          stdin: new Blob([`Context: ${sessionUrl}\n`]),
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [exitCode, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ])
      const input = (requests[0]?.body.variables as { input: Record<string, string> }).input

      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      expect(requests).toHaveLength(2)
      expect(input.description).toBe(`Context: ${sessionUrl}\n`)
      expect(requests[1]?.body).toMatchObject({
        variables: { input: { issueId: 'issue-1', url: sessionUrl } },
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test('documents the fresh-shell fast path', async () => {
    const skill = await Bun.file(path.join(linearDir, 'SKILL.md')).text()

    expect(skill).toContain('Every shell tool call starts in a fresh process')
    expect(skill).toContain('issue-context.sh')
    expect(skill).toContain('do not inspect the token')
    expect(skill).toContain('Never\ndefine a `lin()` function')
  })

  test('pins credential-bearing requests to Linear', async () => {
    const graphql = await Bun.file(path.join(scriptsDir, 'graphql.sh')).text()

    expect(graphql).toContain('graphql_url="https://api.linear.app/graphql"')
    expect(graphql).toContain('/usr/bin/curl')
    expect(graphql).not.toContain('LINEAR_GRAPHQL_URL')
  })
})
