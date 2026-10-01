import { accessSync, chmodSync, constants, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { getBuiltinSkillsDirectory } from '@/lib/agent/skill-store/inject'

const skill = join(getBuiltinSkillsDirectory(), 'posthog')

// Serves one canned backend response: writes it to curl's -o target and prints 200.
function fakeCurl(body: unknown): string {
  return `#!/usr/bin/env bash
out=
prev=
for arg in "$@"; do
  if [[ "$prev" == -o ]]; then out=$arg; fi
  prev=$arg
done
cat >"$out" <<'JSON'
${JSON.stringify(body)}
JSON
printf 200
`
}

function runSetup(body: unknown) {
  const home = mkdtempSync(join(tmpdir(), 'nuphos-posthog-skill-'))
  const bin = join(home, 'bin')

  Bun.spawnSync(['mkdir', '-p', bin])
  writeFileSync(join(bin, 'curl'), fakeCurl(body))
  chmodSync(join(bin, 'curl'), 0o755)
  const proc = Bun.spawnSync(
    ['bash', join(skill, 'scripts/setup-credentials.sh'), 'team', 'integration'],
    {
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: home,
        NUPHOS_TOKEN: 'token',
        NUPHOS_BACKEND_URL: 'http://backend.invalid',
      },
    },
  )

  return { proc, envFile: join(home, '.posthog', 'nuphos.env') }
}

describe('posthog skill', () => {
  test('ships an executable setup script and query helper', () => {
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toStartWith('---\nname: posthog\n')
    for (const script of ['scripts/setup-credentials.sh', 'scripts/posthog.py']) {
      expect(() => accessSync(join(skill, script), constants.X_OK), script).not.toThrow()
    }
  })

  test('setup writes host, token and project ids to an owner-only env file', () => {
    const { proc, envFile } = runSetup({
      bindingId: 'integration',
      apiBaseUrl: 'https://eu.posthog.com/',
      accessToken: "pha_it's",
      expiresAt: '2026-09-27T12:00:00.000Z',
      scope: 'user:read project:read insight:read',
      projects: [
        { id: 12, name: 'Web', organizationName: 'Acme' },
        { id: 34, name: 'App', organizationName: 'Acme' },
      ],
    })

    expect(proc.exitCode, proc.stderr.toString()).toBe(0)
    expect(statSync(envFile).mode & 0o777).toBe(0o600)
    const exported = Bun.spawnSync([
      'bash',
      '-c',
      `source "${envFile}" && printf '%s|%s|%s|%s|%s' "$POSTHOG_HOST" "$POSTHOG_ACCESS_TOKEN" "$POSTHOG_PROJECT_ID" "$POSTHOG_PROJECT_IDS" "$POSTHOG_SCOPES"`,
    ])

    expect(exported.stdout.toString()).toBe("https://eu.posthog.com|pha_it's|12|12,34|user:read project:read insight:read")
    expect(proc.stdout.toString()).not.toContain('pha_')
  })

  test('setup refuses a binding with no projects', () => {
    const { proc } = runSetup({
      apiBaseUrl: 'https://us.posthog.com',
      accessToken: 'pha_x',
      projects: [],
    })

    expect(proc.exitCode).not.toBe(0)
    expect(proc.stderr.toString()).toContain('no projects selected')
  })

  test.each([
    ['/api/projects/99/insights/', 'project 99 is not enabled'],
    ['/api/projects/99', 'project 99 is not enabled'],
    ['/api/environments/99', 'project 99 is not enabled'],
    ['/api/projects/12/../99/', 'refusing path'],
    ['/api/projects/%39%39/', 'refusing path'],
    ['/internal/admin', 'refusing path'],
  ])('the helper refuses %s without calling PostHog', (path, message) => {
    const proc = helper(['get', path], 'https://us.posthog.com')

    expect(proc.exitCode).toBe(2)
    expect(proc.stderr.toString()).toContain(message)
  })

  test.each([
    [['query', 'select 1'], 'lacks query:read'],
    [['get', 'dashboards/'], 'lacks dashboard:read'],
    [['write', 'PATCH', 'feature_flags/5/', '--data', '{}'], 'lacks feature_flag:write'],
    [['write', 'POST', 'query/', '--data', '{}'], 'only supported on a known PostHog resource'],
  ])('the helper refuses %p outside the granted scopes', (args, message) => {
    const proc = helper(args, 'https://us.posthog.com')

    expect(proc.exitCode).toBe(2)
    expect(proc.stderr.toString()).toContain(message)
  })

  test('a write without --confirm is a dry run that changes nothing', () => {
    const proc = helper(
      ['write', 'PATCH', 'feature_flags/5/', '--data', '{"active": false}'],
      'http://127.0.0.1:9',
      'feature_flag:read feature_flag:write',
    )

    expect(proc.exitCode).toBe(3)
    expect(proc.stdout.toString()).toContain('DRY RUN - nothing was changed.')
    expect(proc.stdout.toString()).toContain('Would PATCH http://127.0.0.1:9/api/projects/12/feature_flags/5/')
  })

  test('the helper only sends the token to the PostHog Cloud hosts', () => {
    const proc = helper(['get', '/api/users/@me/'], 'http://127.0.0.1:9')

    expect(proc.exitCode).toBe(2)
    expect(proc.stderr.toString()).toContain('POSTHOG_HOST must be one of')
  })
})

function helper(args: string[], host: string, scopes = 'insight:read feature_flag:read') {
  return Bun.spawnSync(['python3', join(skill, 'scripts/posthog.py'), ...args], {
    env: {
      PATH: process.env.PATH ?? '',
      POSTHOG_HOST: host,
      POSTHOG_ACCESS_TOKEN: 'pha_x',
      POSTHOG_PROJECT_ID: '12',
      POSTHOG_PROJECT_IDS: '12,34',
      POSTHOG_SCOPES: scopes,
    },
  })
}
