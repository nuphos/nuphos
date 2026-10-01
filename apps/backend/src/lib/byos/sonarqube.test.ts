import { describe, expect, test } from 'bun:test'

import {
  blockedSonarqubeBaseUrlReason,
  getSonarqubeProjectReport,
  resolvePublicSonarqubeTarget,
  sonarqubeRequest,
  verifySonarqubeCredentials,
} from './sonarqube'

import type { SonarqubeCredentials, SonarqubeRequestDependencies } from './sonarqube'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const credentials: SonarqubeCredentials = {
  baseUrl: 'https://sonarqube.example.com/',
  token: 'squ_secret',
}

function requestDependencies(
  request: SonarqubeRequestDependencies['request'],
): SonarqubeRequestDependencies {
  return {
    resolveTarget: async (baseUrl) => ({
      hostname: new URL(baseUrl).hostname,
      address: '93.184.216.34',
      family: 4,
    }),
    request,
  }
}

describe('SonarQube outbound host guard', () => {
  test('rejects private literals including IPv4-mapped IPv6', () => {
    for (const url of [
      'http://127.0.0.1:9000',
      'http://10.0.0.1:9000',
      'http://169.254.169.254',
      'http://[::1]:9000',
      'http://[::ffff:127.0.0.1]:9000',
      'http://[::ffff:7f00:1]:9000',
    ]) {
      expect(blockedSonarqubeBaseUrlReason(url), url).not.toBeNull()
    }
  })

  test('rejects a public hostname when DNS resolves it to a private address', async () => {
    await expect(
      resolvePublicSonarqubeTarget('https://sonarqube.example.com', async () => [
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('sonarqubeRequest', () => {
  test('pins the validated target, uses bearer auth, and encodes query parameters', async () => {
    let request: Parameters<SonarqubeRequestDependencies['request']>[0] | null = null
    const dependencies = requestDependencies(async (input) => {
      request = input

      return json({ ok: true })
    })

    await sonarqubeRequest(
      credentials,
      '/api/components/search',
      {
        query: new URLSearchParams({ q: 'api gateway', qualifiers: 'TRK' }),
      },
      dependencies,
    )

    expect(request).not.toBeNull()
    expect(request!.url.toString()).toBe(
      'https://sonarqube.example.com/api/components/search?q=api+gateway&qualifiers=TRK',
    )
    expect(request!.headers.get('authorization')).toBe('Bearer squ_secret')
    expect(request!.target).toEqual({
      hostname: 'sonarqube.example.com',
      address: '93.184.216.34',
      family: 4,
    })
  })
})

describe('verifySonarqubeCredentials', () => {
  test('validates the token before reading the server version', async () => {
    const paths: string[] = []
    const dependencies = requestDependencies(async ({ url }) => {
      paths.push(url.pathname)
      if (url.pathname === '/api/authentication/validate') return json({ valid: true })
      if (url.pathname === '/api/server/version') {
        return new Response('25.7.0.110598', {
          headers: { 'content-type': 'text/plain' },
        })
      }

      return json({}, 404)
    })

    await expect(verifySonarqubeCredentials(credentials, dependencies)).resolves.toEqual({
      version: '25.7.0.110598',
    })
    expect(paths).toEqual(['/api/authentication/validate', '/api/server/version'])
  })
})

describe('getSonarqubeProjectReport', () => {
  test('aggregates a scoped report and degrades only unavailable hotspots', async () => {
    const queries = new Map<string, URLSearchParams>()
    const dependencies = requestDependencies(async ({ url }) => {
      queries.set(url.pathname, url.searchParams)
      switch (url.pathname) {
        case '/api/qualitygates/project_status':
          return json({ projectStatus: { status: 'ERROR' } })
        case '/api/measures/component':
          return json({ component: { key: 'fixture' } })
        case '/api/issues/search':
          return json({ total: 2, issues: [{ key: 'ISSUE-1' }] })
        case '/api/hotspots/search':
          return json({ errors: [{ msg: 'Hotspots are unavailable' }] }, 404)
        case '/api/project_analyses/search':
          return json({ analyses: [{ key: 'ANALYSIS-1' }] })
        default:
          return json({}, 404)
      }
    })

    const report = await getSonarqubeProjectReport(
      credentials,
      {
        projectKey: 'fixture',
        branch: 'safe test',
      },
      dependencies,
    )

    expect(report.projectKey).toBe('fixture')
    expect(report.branch).toBe('safe test')
    expect(report.pullRequest).toBeNull()
    expect(report.qualityGate).toEqual({ projectStatus: { status: 'ERROR' } })
    expect(report.hotspots).toMatchObject({ unavailable: true })
    expect(queries.get('/api/issues/search')?.get('componentKeys')).toBe('fixture')
    expect(queries.get('/api/issues/search')?.get('branch')).toBe('safe test')
    expect(queries.get('/api/project_analyses/search')?.get('project')).toBe('fixture')
  })
})
