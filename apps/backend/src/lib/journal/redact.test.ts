import { describe, expect, test } from 'bun:test'

import { redactSecrets, shannonEntropy } from './redact'

describe('redactSecrets', () => {
  test('AWS access key ids', () => {
    const { redacted, matches } = redactSecrets(
      'aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE',
    )

    expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(redacted).toContain('[REDACTED:')
    expect(matches.some((m) => m.kind === 'aws-access-key-id')).toBe(true)
  })

  test('secret-style assignments (env exports, yaml, flags with =)', () => {
    const input = [
      'export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
      'password: hunter2secret',
      'API_KEY="sk-proj-abc123def456"',
    ].join('\n')
    const { redacted } = redactSecrets(input)

    expect(redacted).not.toContain('wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY')
    expect(redacted).not.toContain('hunter2secret')
    expect(redacted).not.toContain('sk-proj-abc123def456')
    expect(redacted).toContain('AWS_SECRET_ACCESS_KEY=[REDACTED:secret-assignment]')
  })

  test('JSON-serialized objects with quoted secret keys (PR #711 F1)', () => {
    const { redacted } = redactSecrets(
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- fake fixture; the test asserts it gets redacted
      JSON.stringify({ password: 'short-pwd', apiKey: 'sk-live-000111', note: 'keep me' }),
    )

    expect(redacted).not.toContain('short-pwd')
    expect(redacted).not.toContain('sk-live-000111')
    expect(redacted).toContain('"note":"keep me"')
    expect(redacted).toContain('[REDACTED:secret-assignment]')
  })

  test('a bare author key is not a secret, the rest of the auth family still is (PR #711 F6)', () => {
    // git/gh tool output carries "author" on nearly every record; the quoted
    // JSON value may hold spaces the bare form could not, so this key had to
    // be exempted by name once tool output started reaching the redactor.
    expect(redactSecrets('{"author":"Can Yu","authors":["Someone Else"]}').redacted).toBe(
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
      expect(redactSecrets(input).redacted).toContain('[REDACTED:secret-assignment]')
    }

    // …and the exemption still holds for a bare value, not just the JSON form.
    expect(redactSecrets('author=dependabot[bot]').redacted).toBe('author=dependabot[bot]')
  })

  test('CLI --token/--password flags', () => {
    const flagValue = 'hunter2pw'
    const { redacted } = redactSecrets(
      `kubectl --token eyJraWQiOiJhYmNkZWYi.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl get pods && mysql --password=${flagValue}`,
    )

    expect(redacted).not.toContain('c2lnbmF0dXJl')
    expect(redacted).not.toContain(flagValue)
  })

  test('JWTs anywhere in the text', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const { redacted, matches } = redactSecrets(`curl -H "X-Auth: ${jwt}" https://api.example.com`)

    expect(redacted).not.toContain(jwt)
    expect(matches.some((m) => m.kind === 'jwt')).toBe(true)
  })

  test('connection-string passwords keep the user, drop the password', () => {
    const { redacted } = redactSecrets(
      'mongosh mongodb://admin:sup3r-s3cret@cluster0.mongodb.net/prod',
    )

    expect(redacted).toContain('mongodb://admin:[REDACTED:url-credentials]@cluster0.mongodb.net')
    expect(redacted).not.toContain('sup3r-s3cret')
  })

  test('already-redacted text passes through with zero matches (idempotent)', () => {
    const once = redactSecrets(
      'mongodb://admin:sup3r-s3cret@cluster0.mongodb.net/prod --password hunter2-s3cret',
    ).redacted
    const twice = redactSecrets(once)

    expect(twice.redacted).toBe(once)
    expect(twice.matches).toEqual([])
  })

  test('a real secret merely prefixed with "[REDACTED" is still redacted (lookahead bypass)', () => {
    const url = redactSecrets('mongodb://admin:[REDACTEDx-realpass@cluster0.mongodb.net/prod')

    expect(url.redacted).not.toContain('realpass')
    expect(url.matches.some((m) => m.kind === 'url-credentials')).toBe(true)

    const flag = redactSecrets('login --password [REDACTED:zz]realpass')

    expect(flag.redacted).not.toContain('realpass')
    expect(flag.matches.some((m) => m.kind === 'secret-flag')).toBe(true)
  })

  test('PEM private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...base64...\n-----END RSA PRIVATE KEY-----'
    const { redacted } = redactSecrets(`cat > key.pem <<'EOF'\n${pem}\nEOF`)

    expect(redacted).not.toContain('MIIEow')
    expect(redacted).toContain('[REDACTED:pem-private-key]')
  })

  test('Authorization: Bearer headers', () => {
    const { redacted } = redactSecrets('curl -H "Authorization: Bearer sk_live_a1B2c3D4e5F6g7H8"')

    expect(redacted).not.toContain('sk_live_a1B2c3D4e5F6g7H8')
    expect(redacted).toContain('Bearer [REDACTED:bearer-token]')
  })

  test('Authorization: Basic headers (short base64 below the entropy floor)', () => {
    const { redacted } = redactSecrets('curl -H "Authorization: Basic dXNlcjpwYXNzd29yZA=="')

    expect(redacted).not.toContain('dXNlcjpwYXNzd29yZA==')
    expect(redacted).toContain('Basic [REDACTED:basic-auth]')
  })

  test('GitHub and Slack token shapes', () => {
    const { redacted } = redactSecrets(
      'git remote set-url origin https://ghp_AbCdEfGhIjKlMnOpQrStUvWx123456@github.com/o/r && export SLACK=xoxb-1234567890-abcdefghij',
    )

    expect(redacted).not.toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWx123456')
    expect(redacted).not.toContain('xoxb-1234567890-abcdefghij')
  })

  test('high-entropy sweep catches unlabeled random tokens', () => {
    const randomBlob = 'tQ9rX2mK7pL4wZ8vN3jF6hB1cY5dA0sE9gU4iO7T'
    const { redacted, matches } = redactSecrets(`some-cli --config ${randomBlob}`)

    expect(redacted).not.toContain(randomBlob)
    expect(matches.some((m) => m.kind === 'high-entropy')).toBe(true)
  })

  test('leaves ordinary commands, paths and hex digests untouched', () => {
    const input =
      'kubectl get pods -n environment-xyz -o wide && sha256sum file.tar.gz # ba52879a65f80fe52db77d9df203b0f92f97afb1543ba615ee2e2e4a3c336cb8'
    const { redacted, redactedCount } = redactSecrets(input)

    expect(redacted).toBe(input)
    expect(redactedCount).toBe(0)
  })

  test('multiple secrets are all counted', () => {
    const { redactedCount } = redactSecrets(
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
