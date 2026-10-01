/* eslint-disable sonarjs/no-os-command-from-path -- Exercises shell scripts with a test-owned PATH and fake credential tools. */
/* eslint-disable sonarjs/no-hardcoded-passwords -- Synthetic credential fixture; no real secrets or cloud requests. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

const skills = join(import.meta.dir, 'skills')
const team = '0123456789abcdef01234567'

test('credential setup respects session config paths and never uses the shared GitHub keychain', () => {
  const root = mkdtempSync(join(tmpdir(), 'nuphos-skill-isolation-'))
  const bin = join(root, 'bin')

  mkdirSync(bin)
  // No network or real credentials: produce the exact credential response shape.
  writeFileSync(
    join(bin, 'curl'),
    `#!/usr/bin/env python3
import json, os, sys
account = os.environ['TEST_ACCOUNT']
payload = json.dumps(dict(accessToken='gcp-' + account, projectId='project-' + account,
    serviceAccountEmail=account + '@example.invalid', expiresAt='2099-01-01T00:00:00Z',
    token='github-' + account, accountLogin=account))
if '-o' in sys.argv:
    open(sys.argv[sys.argv.index('-o') + 1], 'w').write(payload)
    print('200', end='')
else:
    print(payload)
`,
    { mode: 0o755 },
  )
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env python3
import os, sys
from pathlib import Path
config = Path(os.environ['GH_CONFIG_DIR'])
if sys.argv[1:3] == ['auth', 'setup-git']:
    Path(os.environ.get('GIT_CONFIG_GLOBAL', os.environ['HOME'] + '/.gitconfig')).write_text('session-helper-' + os.environ['TEST_ACCOUNT'])
else:
    raise AssertionError(sys.argv)
`,
    { mode: 0o755 },
  )
  const environment = (id: string) => {
    const home = join(root, id)

    mkdirSync(home)

    return {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: home,
      NUPHOS_SESSION_HOME: home,
      NUPHOS_SESSION_ID: id,
      NUPHOS_TOKEN: 'synthetic',
      NUPHOS_BACKEND_URL: 'https://backend.invalid',
      CLOUDSDK_CONFIG: join(home, 'custom-gcloud'),
      GH_CONFIG_DIR: join(home, 'custom-gh'),
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      TEST_ACCOUNT: id,
    }
  }

  try {
    const a = environment('a')
    const b = environment('b')

    const legacy = environment('legacy')

    legacy.CLOUDSDK_CONFIG = join(legacy.HOME, '.config/gcloud')
    legacy.GH_CONFIG_DIR = join(legacy.HOME, '.config/gh')
    for (const env of [b, a, legacy]) {
      for (const [provider, account] of [
        ['gcloud', 'project'],
        ['github', '123'],
      ]) {
        execFileSync(
          'bash',
          [join(skills, provider!, 'scripts/setup-credentials.sh'), team, account!],
          {
            env:
              env === legacy
                ? Object.fromEntries(
                    Object.entries(env).filter(
                      ([key]) =>
                        ![
                          'NUPHOS_SESSION_HOME',
                          'NUPHOS_SESSION_ID',
                          'CLOUDSDK_CONFIG',
                          'GH_CONFIG_DIR',
                          'GIT_CONFIG_GLOBAL',
                        ].includes(key),
                    ),
                  )
                : env,
            stdio: 'pipe',
          },
        )
      }
    }
    for (const env of [b, a, legacy]) {
      const active = readFileSync(join(env.CLOUDSDK_CONFIG, 'active_config'), 'utf8').trim()
      const config = readFileSync(
        join(env.CLOUDSDK_CONFIG, 'configurations', `config_${active}`),
        'utf8',
      )

      expect(config).toContain(`account = ${env.TEST_ACCOUNT}@example.invalid`)
      expect(config).toContain(`project = project-${env.TEST_ACCOUNT}`)
      expect(readFileSync(join(env.GH_CONFIG_DIR, 'hosts.yml'), 'utf8')).toContain(
        `github-${env.TEST_ACCOUNT}`,
      )
      expect(statSync(join(env.GH_CONFIG_DIR, 'hosts.yml')).mode & 0o777).toBe(0o600)
      expect(readFileSync(env.GIT_CONFIG_GLOBAL, 'utf8')).toBe(`session-helper-${env.TEST_ACCOUNT}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GitHub token refresh preserves other hosts and is readable by real gh and git helpers', () => {
  const root = mkdtempSync(join(tmpdir(), 'nuphos-gh-auth-'))
  const target = join(root, 'hosts.yml')
  const write = (token: string) =>
    execFileSync('python3', [join(skills, 'github/scripts/write-auth.py'), root], {
      input: JSON.stringify({ token }),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

  try {
    const other =
      'enterprise.example.invalid:\n    user: enterprise-bot\n    oauth_token: enterprise-synthetic\n'

    writeFileSync(target, `github.com:\n    oauth_token: old\n${other}`)
    write('synthetic-first')
    write('synthetic-refreshed')
    expect(readFileSync(target, 'utf8')).toContain(other)
    expect(readFileSync(target, 'utf8')).not.toContain('synthetic-first')
    expect(statSync(target).mode & 0o777).toBe(0o600)
    const gh = Bun.which('gh')

    if (gh) {
      const env = {
        PATH: process.env.PATH,
        HOME: root,
        GH_CONFIG_DIR: root,
        GIT_CONFIG_GLOBAL: join(root, '.gitconfig'),
      }
      const output = execFileSync(gh, ['auth', 'token', '--hostname', 'github.com'], {
        env,
        encoding: 'utf8',
      })

      expect(output.trim()).toBe('synthetic-refreshed')
      execFileSync(gh, ['auth', 'setup-git', '--hostname', 'github.com'], { env, stdio: 'pipe' })
      const credential = execFileSync(gh, ['auth', 'git-credential', 'get'], {
        env,
        input: 'protocol=https\nhost=github.com\n\n',
        encoding: 'utf8',
      })

      expect(credential).toContain('password=synthetic-refreshed')
      expect(readFileSync(env.GIT_CONFIG_GLOBAL, 'utf8')).toContain('auth git-credential')
      // Older gh versions migrate the hosts file to block YAML on first use.
      write('synthetic-after-migration')
      expect(
        execFileSync(gh, ['auth', 'token', '--hostname', 'github.com'], {
          env,
          encoding: 'utf8',
        }).trim(),
      ).toBe('synthetic-after-migration')
    }
    writeFileSync(
      target,
      JSON.stringify({ 'enterprise.example.invalid': { oauth_token: 'enterprise-synthetic' } }),
    )
    write('synthetic-json')
    expect(JSON.parse(readFileSync(target, 'utf8'))['enterprise.example.invalid'].oauth_token).toBe(
      'enterprise-synthetic',
    )
    writeFileSync(target, 'unsupported: [custom-format]\n')
    expect(() => write('never-written')).toThrow()
    expect(readFileSync(target, 'utf8')).toBe('unsupported: [custom-format]\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
