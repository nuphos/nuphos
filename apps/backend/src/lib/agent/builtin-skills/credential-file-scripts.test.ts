import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { getBuiltinSkillsDirectory } from '@/lib/agent/skill-store/inject'

const skills = getBuiltinSkillsDirectory()

function jwt(secret: string) {
  const payload = Buffer.from(JSON.stringify({ ori: 'http://backend.invalid' })).toString(
    'base64url',
  )

  return `header.${payload}.${secret}`
}

// Records every argument and --config file curl receives, then fails the call.
const fakeCurl = `#!/usr/bin/env bash
prev=
for arg in "$@"; do
  printf '%s\\n' "$arg" >>"$CURL_CAPTURE"
  if [[ "$prev" == --config ]]; then cat "$arg" >>"$CURL_CAPTURE"; fi
  prev=$arg
done
exit 22
`

async function capturedAuthorization(script: string[], stdin = '', revoked = false) {
  const dir = mkdtempSync(join(tmpdir(), 'nuphos-credential-scripts-'))
  const bin = join(dir, 'bin')
  const credentials = join(dir, 'credentials')
  const capture = join(dir, 'capture')

  Bun.spawnSync(['mkdir', '-p', bin, credentials])
  writeFileSync(join(bin, 'curl'), fakeCurl)
  chmodSync(join(bin, 'curl'), 0o755)
  writeFileSync(capture, '')
  if (!revoked) {
    writeFileSync(join(credentials, 'NUPHOS_TOKEN'), jwt('fresh'))
    writeFileSync(join(credentials, 'NUPHOS_PLAN_API_TOKEN'), jwt('fresh'))
  }
  const child = Bun.spawn(['bash', ...script], {
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: dir,
      CURL_CAPTURE: capture,
      OPENAB_CREDENTIALS_DIR: credentials,
      NUPHOS_TOKEN: jwt('stale'),
      NUPHOS_PLAN_API_TOKEN: jwt('stale'),
      NUPHOS_PLAN_API_BASE: 'http://backend.invalid/plans',
      NUPHOS_BACKEND_URL: 'http://backend.invalid',
      NUPHOS_SESSION_ID: 'session',
    },
    stdin: new Blob([stdin]),
    stdout: 'ignore',
    stderr: 'ignore',
  })

  await child.exited

  return readFileSync(capture, 'utf8')
}

describe('skill scripts prefer the per-turn credential file over the spawn-time env', () => {
  const cases: [string, string[], string?][] = [
    ['nuphos-plan request', [join(skills, 'nuphos-plan/scripts/_request.sh'), 'GET', '/1']],
    ['Nuphos API helper', [join(skills, '_runtime/scripts/nuphos-api.sh'), 'GET', '/teams']],
    [
      'file transfer',
      [join(skills, 'file-transfer/scripts/transfer-pull.sh'), 'team', 'group', 'out'],
    ],
    ['credential setup', [join(skills, 'aws/scripts/setup-credentials.sh'), 'team', 'account']],
    [
      'PostHog credential setup',
      [join(skills, 'posthog/scripts/setup-credentials.sh'), 'team', 'integration'],
    ],
  ]

  for (const [name, script, stdin] of cases) {
    test(name, async () => {
      const captured = await capturedAuthorization(script, stdin)

      expect(captured).toContain(`Bearer ${jwt('fresh')}`)
      expect(captured).not.toContain('stale')
    })

    test(`${name} never falls back to a revoked token`, async () => {
      expect(await capturedAuthorization(script, stdin, true)).not.toContain('stale')
    })
  }
})
