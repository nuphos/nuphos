import { lintSource } from '@secretlint/core'
import { describe, expect, test } from 'bun:test'

import { NUPHOS_RULE_ID, nuphosSecretRule } from './nuphos-rule'
import {
  findEmbeddedSecret,
  findSecrets,
  redactSecrets,
  redactTokenShapes,
  shannonEntropy,
} from './scan'

describe('redactSecrets', () => {
  test('AWS access key ids', async () => {
    const { redacted, matches } = await redactSecrets(
      'aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE',
    )

    expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(redacted).toContain('[REDACTED:')
    expect(matches.some((m) => m.kind === 'aws-access-key-id')).toBe(true)
  })

  test('secret-style assignments (env exports, yaml, flags with =)', async () => {
    const input = [
      'export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
      'password: hunter2secret',
      'API_KEY="sk-proj-abc123def456"',
    ].join('\n')
    const { redacted } = await redactSecrets(input)

    expect(redacted).not.toContain('wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY')
    expect(redacted).not.toContain('hunter2secret')
    expect(redacted).not.toContain('sk-proj-abc123def456')
    expect(redacted).toContain('AWS_SECRET_ACCESS_KEY=[REDACTED:secret-assignment]')
  })

  test('JSON-serialized objects with quoted secret keys (PR #711 F1)', async () => {
    const { redacted } = await redactSecrets(
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- fake fixture; the test asserts it gets redacted
      JSON.stringify({ password: 'short-pwd', apiKey: 'sk-live-000111', note: 'keep me' }),
    )

    expect(redacted).not.toContain('short-pwd')
    expect(redacted).not.toContain('sk-live-000111')
    expect(redacted).toContain('"note":"keep me"')
    expect(redacted).toContain('[REDACTED:secret-assignment]')
  })

  test('a bare author key is not a secret, the rest of the auth family still is (PR #711 F6)', async () => {
    // git/gh tool output carries "author" on nearly every record; the quoted
    // JSON value may hold spaces the bare form could not, so this key had to
    // be exempted by name once tool output started reaching the redactor.
    expect((await redactSecrets('{"author":"Can Yu","authors":["Someone Else"]}')).redacted).toBe(
      '{"author":"Can Yu","authors":["Someone Else"]}',
    )

    // The exemption is for "author" as the WHOLE key. Anything that merely
    // starts with it is still a candidate secret — a plain \b would have let
    // author-key through, since a hyphen is a word boundary (F7).
    for (const input of [
      '{"authorization":"opaque-token-value-1234"}',
      'Authorization: opaque-token-value-1234',
      'authorized_keys=ssh-rsa AAAAB3NzaC1yc2EAAAA',
      '{"auth_token":"abcdef123456"}',
      'author-key=sk-live-secret123456',
      '{"author-token":"abcdef123456"}',
    ]) {
      expect((await redactSecrets(input)).redacted).toContain('[REDACTED:secret-assignment]')
    }

    // …and the exemption still holds for a bare value, not just the JSON form.
    expect((await redactSecrets('author=dependabot[bot]')).redacted).toBe('author=dependabot[bot]')
  })

  test('CLI --token/--password flags', async () => {
    const flagValue = 'hunter2pw'
    const { redacted } = await redactSecrets(
      `kubectl --token eyJraWQiOiJhYmNkZWYi.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl get pods && mysql --password=${flagValue}`,
    )

    expect(redacted).not.toContain('c2lnbmF0dXJl')
    expect(redacted).not.toContain(flagValue)
  })

  test('JWTs anywhere in the text', async () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const { redacted, matches } = await redactSecrets(
      `curl -H "X-Auth: ${jwt}" https://api.example.com`,
    )

    expect(redacted).not.toContain(jwt)
    expect(matches.some((m) => m.kind === 'jwt')).toBe(true)
  })

  test('Nuphos session and CLI tokens anywhere in the text', async () => {
    const session = 'nus_Q2hhbmdlTWVQbGVhc2VJdElzTm90QVJlYWxUb2tlbjAx'
    const cli = 'nup_Q2hhbmdlTWVQbGVhc2VJdElzTm90QVJlYWxUb2tlbjAy'
    const { redacted } = await redactSecrets(`NUPHOS_TOKEN=${session} other=${cli}`)

    expect(redacted).not.toContain(session)
    expect(redacted).not.toContain(cli)
  })

  test('connection-string passwords keep the user, drop the password', async () => {
    const { redacted } = await redactSecrets(
      'mongosh mongodb://admin:sup3r-s3cret@cluster0.mongodb.net/prod',
    )

    expect(redacted).toContain('mongodb://admin:[REDACTED:url-credentials]@cluster0.mongodb.net')
    expect(redacted).not.toContain('sup3r-s3cret')
  })

  test('already-redacted text passes through with zero matches (idempotent)', async () => {
    const { redacted: once } = await redactSecrets(
      'mongodb://admin:sup3r-s3cret@cluster0.mongodb.net/prod --password hunter2-s3cret',
    )
    const twice = await redactSecrets(once)

    expect(twice.redacted).toBe(once)
    expect(twice.matches).toEqual([])
  })

  test('a real secret merely prefixed with "[REDACTED" is still redacted (lookahead bypass)', async () => {
    const url = await redactSecrets('mongodb://admin:[REDACTEDx-realpass@cluster0.mongodb.net/prod')

    expect(url.redacted).not.toContain('realpass')
    expect(url.matches.some((m) => m.kind === 'url-credentials')).toBe(true)

    const flag = await redactSecrets('login --password [REDACTED:zz]realpass')

    expect(flag.redacted).not.toContain('realpass')
    expect(flag.matches.some((m) => m.kind === 'secret-flag')).toBe(true)
  })

  test('PEM private key blocks', async () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...base64...\n-----END RSA PRIVATE KEY-----'
    const { redacted } = await redactSecrets(`cat > key.pem <<'EOF'\n${pem}\nEOF`)

    expect(redacted).not.toContain('MIIEow')
    expect(redacted).toContain('[REDACTED:pem-private-key]')
  })

  test('Authorization: Bearer headers', async () => {
    const { redacted } = await redactSecrets(
      'curl -H "Authorization: Bearer sk_live_a1B2c3D4e5F6g7H8"',
    )

    expect(redacted).not.toContain('sk_live_a1B2c3D4e5F6g7H8')
    expect(redacted).toContain('Bearer [REDACTED:bearer-token]')
  })

  test('Authorization: Basic headers (short base64 below the entropy floor)', async () => {
    const { redacted } = await redactSecrets('curl -H "Authorization: Basic dXNlcjpwYXNzd29yZA=="')

    expect(redacted).not.toContain('dXNlcjpwYXNzd29yZA==')
    expect(redacted).toContain('Basic [REDACTED:basic-auth]')
  })

  test('GitHub and Slack token shapes', async () => {
    const { redacted } = await redactSecrets(
      'git remote set-url origin https://ghp_AbCdEfGhIjKlMnOpQrStUvWx123456@github.com/o/r && export SLACK=xoxb-1234567890-abcdefghij',
    )

    expect(redacted).not.toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWx123456')
    expect(redacted).not.toContain('xoxb-1234567890-abcdefghij')
  })

  test('high-entropy sweep catches unlabeled random tokens', async () => {
    const randomBlob = 'tQ9rX2mK7pL4wZ8vN3jF6hB1cY5dA0sE9gU4iO7T'
    const { redacted, matches } = await redactSecrets(`some-cli --config ${randomBlob}`)

    expect(redacted).not.toContain(randomBlob)
    expect(matches.some((m) => m.kind === 'high-entropy')).toBe(true)
  })

  test('leaves ordinary commands, paths and hex digests untouched', async () => {
    const input =
      'kubectl get pods -n environment-xyz -o wide && sha256sum file.tar.gz # ba52879a65f80fe52db77d9df203b0f92f97afb1543ba615ee2e2e4a3c336cb8'
    const { redacted, redactedCount } = await redactSecrets(input)

    expect(redacted).toBe(input)
    expect(redactedCount).toBe(0)
  })

  test('multiple secrets are all counted', async () => {
    const { redactedCount } = await redactSecrets(
      'export TOKEN=abc123secretvalue && export API_KEY=def456secretvalue',
    )

    expect(redactedCount).toBeGreaterThanOrEqual(2)
  })
})

describe('shannonEntropy', () => {
  test('random-looking mixed-case tokens score higher than prose', () => {
    expect(shannonEntropy('tQ9rX2mK7pL4wZ8vN3jF6hB1cY5dA0sE')).toBeGreaterThan(4.5)
    expect(shannonEntropy('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(0)
    expect(shannonEntropy('')).toBe(0)
  })
})

describe('redactTokenShapes', () => {
  test('replaces well-known key shapes', async () => {
    const out = await redactTokenShapes(
      'key ghp_abcdefghijklmnopqrstuvwxyz0123 and AKIAIOSFODNN7EXAMPLE',
    )

    expect(out).toBe('key [REDACTED:github-token] and [REDACTED:aws-access-key-id]')
  })

  test('leaves assignments, ids and commit hashes readable', async () => {
    const text =
      'password=hunter22 author: Ada sha 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b id aB3xY9qZ7mK2pL5nR8tV1wE4uI6oP0sD'

    expect(await redactTokenShapes(text)).toBe(text)
  })
})

// Keys are generated per run so no real-looking credential sits in the repo.
function randomAlnum(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

describe('secretlint preset coverage', () => {
  test('OpenAI project keys and Anthropic keys are redacted by provider', async () => {
    const openai = `sk-proj-${randomAlnum(74)}T3BlbkFJ${randomAlnum(74)}`
    const anthropic = `sk-ant-api03-${randomAlnum(93)}AA`
    const { redacted, matches } = await redactSecrets(`use ${openai} or ${anthropic} today`)

    expect(redacted).toBe('use [REDACTED:openai] or [REDACTED:anthropic] today')
    expect(matches.map((m) => m.kind)).toEqual(['openai', 'anthropic'])
  })

  test('a secretlint-disable comment does not switch the scan off', async () => {
    const slack = `xoxb-${randomAlnum(12)}-${randomAlnum(12)}`
    const { redacted } = await redactSecrets(`// secretlint-disable\nexport SLACK=${slack}`)

    expect(redacted).not.toContain(slack)
  })
})

describe('findSecrets', () => {
  test('reports merged ranges into the original text', async () => {
    const token = `nup_${randomAlnum(40)}`
    const text = `Authorization: Bearer ${token}`
    const findings = await findSecrets(text)

    expect(findings).toEqual([{ kind: 'nuphos-token', range: [22, text.length] }])
  })

  test('token shapes only skips assignments and entropy', async () => {
    expect(await findSecrets(`password=hunter22 blob ${randomAlnum(40)}`, 'tokenShapes')).toEqual(
      [],
    )
  })
})

describe('findEmbeddedSecret', () => {
  test('keeps the messages team skill authoring has always returned', async () => {
    expect(await findEmbeddedSecret(`key AKIA${randomAlnum(16).toUpperCase()}`)).toBe(
      'content appears to contain an AWS access key id',
    )
    expect(await findEmbeddedSecret(`token sk-${randomAlnum(32)}`)).toBe(
      'content appears to contain a secret API key',
    )
    expect(await findEmbeddedSecret('-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn')).toBe(
      'content appears to contain a private key',
    )
  })

  test('names any other key shape it finds', async () => {
    expect(await findEmbeddedSecret(`gh auth ghp_${randomAlnum(36)}`)).toBe(
      'content appears to contain a secret (github-token)',
    )
  })

  test('allows documentation that only references credentials', async () => {
    const doc = '# Deploy\n\nexport TOKEN="$NUPHOS_TOKEN"\npassword: ${DB_PASSWORD}\n'

    expect(await findEmbeddedSecret(doc)).toBeNull()
  })
})

describe('scanner regressions', () => {
  test('a markerless key with dash segments is redacted whole', async () => {
    const key = `sk-${randomAlnum(36)}-${randomAlnum(16)}`
    const { redacted } = await redactSecrets(`token ${key} end`)

    expect(redacted).toBe('token [REDACTED:api-key] end')
  })

  test('an input dense with findings scans in linear time', async () => {
    const line = `password=${randomAlnum(14)}\n`
    const start = performance.now()
    const { redactedCount } = await redactSecrets(line.repeat(32_000))

    expect(redactedCount).toBe(32_000)
    expect(performance.now() - start).toBeLessThan(1_500)
  })

  test('chunked scans keep ranges and do not split a private key', async () => {
    const line = 'kubectl get pods -n prod -o wide\n'
    const filler = line.repeat(1_000)
    // Starts just before the first 32 KB cut, so the block straddles it.
    const prefix = line.repeat(969)
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${line.repeat(50)}-----END RSA PRIVATE KEY-----`
    const token = `ghp_${randomAlnum(36)}`
    const { redacted } = await redactSecrets(`${prefix}${pem}\n${filler}gh ${token}\n`)

    expect(prefix.length).toBeLessThan(32_000)
    expect(prefix.length + pem.length).toBeGreaterThan(32_000)
    expect(redacted).toBe(
      `${prefix}[REDACTED:pem-private-key]\n${filler}gh [REDACTED:github-token]\n`,
    )
  })

  test('a value on the line after its key is found across a chunk cut', async () => {
    const line = 'kubectl get pods -n prod -o wide\n'
    const prefix = line.repeat(969)
    // The key line ends exactly at the first cut, the newline after 32,000 chars.
    const key = `${'x'.repeat(32_000 - prefix.length)} password:`
    const value = randomAlnum(16)
    const text = `${prefix}${key}\n  ${value}\n${line.repeat(10)}`
    const { redacted } = await redactSecrets(text)

    expect(text.indexOf('\n', 32_000)).toBe(prefix.length + key.length)
    expect(redacted).not.toContain(value)
  })

  test('a long line ending in a key keeps its value across the cut', async () => {
    const value = randomAlnum(16)
    const text = `${'ordinary-output '.repeat(2_200)}password:\n  ${value}\n${'ok\n'.repeat(10)}`
    const { redacted } = await redactSecrets(text)

    expect(text.indexOf('password:')).toBeGreaterThan(32_000 - 2_000)
    expect(redacted).not.toContain(value)
  })

  test('a value longer than the overlap is redacted across a mid-line cut', async () => {
    const value = randomAlnum(2_500)
    const text = `${'x '.repeat(14_950)}password="${value}"`
    const { redacted } = await redactSecrets(text)

    expect(redacted).toBe(`${'x '.repeat(14_950)}password=[REDACTED:secret-assignment]`)
  })

  test('a JWT longer than the overlap is redacted whole across a cut', async () => {
    const jwt = `eyJ${randomAlnum(40)}.${randomAlnum(2_600)}.${randomAlnum(40)}`
    const text = `${'x '.repeat(15_500)}${jwt} tail`

    expect(await redactTokenShapes(text)).toBe(`${'x '.repeat(15_500)}[REDACTED:jwt] tail`)
  })

  test('a JWT right after a hyphen is redacted in transcripts', async () => {
    const jwt = `eyJ${randomAlnum(30)}.${randomAlnum(60)}.${randomAlnum(40)}`

    expect(await redactTokenShapes(`logs/session-${jwt}.json`)).toBe(
      'logs/session-[REDACTED:jwt].json',
    )
  })

  test.each([
    ['repeated keywords', 'token'],
    ['a dotted run', 'a.'],
    ['a dashed run', 'x-y'],
    ['JWT prefixes', 'eyJ-'],
    ['JWT prefixes before a dot', 'eyJaaaa-'],
    ['unclosed PEM headers', '-----BEGIN RSA PRIVATE KEY-----\n'],
  ])('1 MB of %s scans in linear time', async (_name, unit) => {
    const text = unit.repeat(Math.ceil(1_000_000 / unit.length))
    const start = performance.now()

    await redactSecrets(text)
    expect(performance.now() - start).toBeLessThan(1_000)
  })

  test('compact JSON without newlines is chunked and stays fast', async () => {
    const passwords = Array.from({ length: 32_000 }, () => randomAlnum(14))
    const json = JSON.stringify(passwords.map((password) => ({ password })))
    const start = performance.now()
    const { redacted } = await redactSecrets(json)

    expect(performance.now() - start).toBeLessThan(1_500)
    for (const password of passwords) expect(redacted).not.toContain(password)
  })

  test('a token cut mid-line is redacted whole', async () => {
    const token = `ghp_${randomAlnum(36)}`
    const text = `${'a'.repeat(31_990)} ${token} tail`
    const { redacted } = await redactSecrets(text)

    expect(redacted).toBe(`${'a'.repeat(31_990)} [REDACTED:github-token] tail`)
  })
})

describe('nuphosSecretRule', () => {
  test('reports through secretlint like any other rule', async () => {
    const token = `nus_${randomAlnum(32)}`
    const result = await lintSource({
      source: { content: `t ${token}`, filePath: 'a.txt', ext: '.txt', contentType: 'text' },
      options: {
        config: { rules: [{ id: NUPHOS_RULE_ID, rule: nuphosSecretRule, options: {} }] },
        noPhysicFilePath: true,
      },
    })

    expect(result.messages.map((m) => [m.ruleId, m.range, m.data])).toEqual([
      [NUPHOS_RULE_ID, [2, 2 + token.length], { kind: 'nuphos-token' }],
    ])
  })
})
