/* eslint-disable sonarjs/no-os-command-from-path -- Runs real git and the setup script against fixture-owned CLI shims. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

const setup = join(import.meta.dir, 'skills/github/scripts/setup-credentials.sh')

test('commit setup reports the current participant without changing Git authors', () => {
  const root = mkdtempSync(join(tmpdir(), 'github-identity-'))
  const bin = join(root, 'bin')
  const repo = join(root, 'repo')
  const other = join(root, 'other')
  const globalConfig = join(root, 'gitconfig')
  const env = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: root,
    GH_CONFIG_DIR: join(root, 'gh'),
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    NUPHOS_TOKEN: 'fixture',
    NUPHOS_BACKEND_URL: 'https://fixture.invalid',
    TEST_AUTHOR_NAME: 'Current Teammate',
    TEST_AUTHOR_EMAIL: 'teammate@example.invalid',
  }
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: 'pipe' }).trim()
  const run = () =>
    execFileSync('bash', [setup, '0123456789abcdef01234567', '123', '--for-commit'], {
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    })

  try {
    mkdirSync(bin)
    mkdirSync(repo)
    mkdirSync(other)
    writeFileSync(globalConfig, '[user]\n\tname = Human\n\temail = human@example.invalid\n')
    const original = readFileSync(globalConfig, 'utf8')

    writeFileSync(
      join(bin, 'curl'),
      `#!/usr/bin/env python3
import json, os
print(json.dumps(dict(token='fixture', accountLogin='different-org', commitCoAuthor=dict(name=os.environ['TEST_AUTHOR_NAME'], email=os.environ['TEST_AUTHOR_EMAIL']))))
`,
      { mode: 0o755 },
    )
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env python3
import json, os, sys
if sys.argv[1:] == ['auth', 'setup-git', '--hostname', 'github.com']:
    pass
else:
    raise AssertionError(sys.argv)
`,
      { mode: 0o755 },
    )
    git(repo, 'init')
    git(other, 'init')
    expect(run()).toContain('Co-authored-by: Current Teammate <teammate@example.invalid>')
    expect(git(repo, 'config', 'user.email')).toBe('human@example.invalid')
    expect(git(other, 'config', 'user.email')).toBe('human@example.invalid')
    expect(readFileSync(globalConfig, 'utf8')).toBe(original)

    env.TEST_AUTHOR_NAME = 'Next Teammate'
    env.TEST_AUTHOR_EMAIL = 'next@example.invalid'
    expect(run()).toContain('Co-authored-by: Next Teammate <next@example.invalid>')
    const beforeFailure = readFileSync(join(repo, '.git/config'), 'utf8')

    env.TEST_AUTHOR_EMAIL = ''
    expect(run).toThrow()
    expect(readFileSync(join(repo, '.git/config'), 'utf8')).toBe(beforeFailure)
    env.TEST_AUTHOR_EMAIL = 'next@example.invalid\nInjected'
    expect(run).toThrow()
    expect(readFileSync(join(repo, '.git/config'), 'utf8')).toBe(beforeFailure)
    env.TEST_AUTHOR_EMAIL = 'next@example.invalid'
    env.TEST_AUTHOR_NAME = 'Name\nInjected'
    expect(run).toThrow()
    expect(readFileSync(join(repo, '.git/config'), 'utf8')).toBe(beforeFailure)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('commit sign-off reports the author GitHub records and deletes its probe branch', () => {
  const root = mkdtempSync(join(tmpdir(), 'github-signoff-'))
  const bin = join(root, 'bin')
  const calls = join(root, 'calls')
  const signoff = join(import.meta.dir, 'skills/github/scripts/commit-signoff.sh')
  const run = (author: string) =>
    execFileSync('bash', [signoff, 'octo/repo'], {
      env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: root, CALLS: calls, AUTHOR: author },
      encoding: 'utf8',
      stdio: 'pipe',
    })

  try {
    mkdirSync(bin)
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env bash
echo "$*" >> "$CALLS"
case "$*" in
  "api repos/octo/repo --jq .default_branch") echo main ;;
  "api repos/octo/repo/git/ref/heads/main --jq .object.sha") echo abc123 ;;
  "api graphql"*) grep -q '"expectedHeadOid": "abc123"' && printf '%s\\n' "$AUTHOR" ;;
esac
`,
      { mode: 0o755 },
    )

    expect(run('Octo Cat\tocto@example.invalid')).toBe(
      'Signed-off-by: Octo Cat <octo@example.invalid>\n',
    )
    const log = readFileSync(calls, 'utf8').trim().split('\n')
    const probe = /refs\/heads\/(nuphos\/signoff-probe-\S+)/.exec(log[2] ?? '')?.[1]
    expect(probe).toBeDefined()
    expect(log.at(-1)).toBe(`api -X DELETE repos/octo/repo/git/refs/heads/${probe}`)

    writeFileSync(calls, '')
    expect(() => run('Octo Cat\t')).toThrow()
    expect(readFileSync(calls, 'utf8').trim().split('\n').at(-1)).toStartWith('api -X DELETE')
    expect(() => run('Octo <Cat>\tocto@example.invalid')).toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
