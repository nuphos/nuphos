import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { getBuiltinSkillsDirectory } from '@/lib/agent/skill-store/inject'

const scripts = join(getBuiltinSkillsDirectory(), 'nuphos-plan', 'scripts')

describe('nuphos-plan semantic scripts', () => {
  test('create hides the bearer from argv and sends a normalized request', async () => {
    const observed: { value: { authorization: string | null; body: unknown } | null } = {
      value: null,
    }
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        observed.value = {
          authorization: request.headers.get('Authorization'),
          body: await request.json(),
        }

        return Response.json(
          {
            id: '12',
            status: 'proposed',
            _links: { app: 'https://nuphos.ai/teams/team-1/plans/12' },
          },
          { status: 201 },
        )
      },
    })
    try {
      const token = 'short-lived-secret'
      const command = ['bash', join(scripts, 'create.sh'), 'Demo plan', 'Demo overview']
      const child = Bun.spawn(command, {
        env: {
          ...process.env,
          NUPHOS_PLAN_API_BASE: `http://127.0.0.1:${String(server.port)}/plans`,
          NUPHOS_PLAN_API_TOKEN: token,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])

      expect(code).toBe(0)
      expect(stderr).toBe('')
      expect(JSON.parse(stdout)).toEqual({
        id: '12',
        status: 'proposed',
        _links: { app: 'https://nuphos.ai/teams/team-1/plans/12' },
      })
      expect(observed.value).toEqual({
        authorization: `Bearer ${token}`,
        body: { title: 'Demo plan', overview: 'Demo overview' },
      })
      expect(command.join(' ')).not.toContain(token)
    } finally {
      server.stop(true)
    }
  })

  test('status script rejects approval because that is a human action', async () => {
    const child = Bun.spawn(['bash', join(scripts, 'set-status.sh'), '12', 'approved'], {
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(await child.exited).toBe(2)
    expect(await new Response(child.stderr).text()).toContain('invalid agent-managed Plan status')
  })

  test('decisions fail locally with the semantic schema instead of reaching the API', async () => {
    const child = Bun.spawn(
      [
        'bash',
        join(scripts, 'set-decisions.sh'),
        '12',
        '[{"title":"Scope","decision":"Production"}]',
      ],
      { env: process.env, stdout: 'pipe', stderr: 'pipe' },
    )

    expect(await child.exited).toBe(2)
    expect(await new Response(child.stderr).text()).toContain(
      'expected [{"label":"Decision name","value":"Chosen value"}]',
    )
  })

  test('command status positional form sends the exact API field names', async () => {
    const observed: { value: unknown } = { value: null }
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        observed.value = await request.json()

        return Response.json({ id: '12', status: 'executing' })
      },
    })
    try {
      const child = Bun.spawn(
        ['bash', join(scripts, 'set-command-statuses.sh'), '12', '0', '1', '2', 'running'],
        {
          env: {
            ...process.env,
            NUPHOS_PLAN_API_BASE: `http://127.0.0.1:${String(server.port)}/plans`,
            NUPHOS_PLAN_API_TOKEN: 'scoped',
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
      ])

      expect(code).toBe(0)
      expect(stderr).toBe('')
      expect(observed.value).toEqual({
        commandStatuses: [{ stepIdx: 0, jobIdx: 1, cmdIdx: 2, status: 'running' }],
      })
    } finally {
      server.stop(true)
    }
  })

  test('command statuses reject legacy and almost-correct field names locally', async () => {
    for (const changes of [
      '[{"stepIndex":0,"jobIndex":0,"commandIndex":0,"status":"done"}]',
      '[{"stepIdx":0,"jobIdx":0,"commandIdx":0,"status":"done"}]',
    ]) {
      const child = Bun.spawn(
        ['bash', join(scripts, 'set-command-statuses.sh'), '12', changes],
        { env: process.env, stdout: 'pipe', stderr: 'pipe' },
      )

      expect(await child.exited).toBe(2)
      expect(await new Response(child.stderr).text()).toContain(
        '[{"stepIdx":0,"jobIdx":0,"cmdIdx":0,"status":"running"}]',
      )
    }
  })

  test('propose validates and builds a complete card in one shell call', async () => {
    const requests: { method: string; path: string; body: unknown }[] = []
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url)
        const body = request.method === 'GET' ? null : await request.json()

        requests.push({ method: request.method, path: url.pathname, body })

        return Response.json({
          id: '12',
          status: 'proposed',
          complete: url.pathname.endsWith('/proposals'),
          _links: { app: 'https://nuphos.ai/teams/team-1/plans/12' },
        })
      },
    })
    try {
      const proposal = {
        title: 'Pause services',
        overview: 'Pause the selected project services.',
        decisions: [{ label: 'Scope', value: 'Production only' }],
        steps: [
          {
            title: 'Pause project',
            jobs: [
              {
                title: 'Services',
                commands: [{ command: 'pause service', description: 'Stops one service' }],
              },
            ],
          },
        ],
        costSummary: 'Runtime charges decrease while paused.',
        riskWorstCase: 'The project is unavailable.',
        riskMitigations: ['Resume every service.'],
      }
      const child = Bun.spawn(['bash', join(scripts, 'propose.sh'), JSON.stringify(proposal)], {
        env: {
          ...process.env,
          NUPHOS_PLAN_API_BASE: `http://127.0.0.1:${String(server.port)}/plans`,
          NUPHOS_PLAN_API_TOKEN: 'scoped',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])

      expect(code).toBe(0)
      expect(stderr).toBe('')
      expect(JSON.parse(stdout)).toEqual({
        id: '12',
        status: 'proposed',
        complete: true,
        _links: { app: 'https://nuphos.ai/teams/team-1/plans/12' },
      })
      expect(requests).toEqual([
        {
          method: 'POST',
          path: '/plans/proposals',
          body: proposal,
        },
      ])
    } finally {
      server.stop(true)
    }
  })

  test('propose enforces server text limits before making a request', async () => {
    const proposal = {
      title: 'Pause services',
      overview: 'Pause the selected project services.',
      decisions: [{ label: 'Scope', value: 'x'.repeat(201) }],
      steps: [
        {
          title: 'Pause project',
          jobs: [
            {
              title: 'Services',
              commands: [{ command: 'pause service', description: 'Stops one service' }],
            },
          ],
        },
      ],
      costSummary: 'Runtime charges decrease while paused.',
      riskWorstCase: 'The project is unavailable.',
      riskMitigations: ['Resume every service.'],
    }
    const child = Bun.spawn(
      ['bash', join(scripts, 'propose.sh'), JSON.stringify(proposal)],
      { env: process.env, stdout: 'pipe', stderr: 'pipe' },
    )

    expect(await child.exited).toBe(2)
    expect(await new Response(child.stderr).text()).toContain('value": "max 200')
  })
})
