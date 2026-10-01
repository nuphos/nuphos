import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_REPORT_TEXT_LENGTH, sanitizeReportText } from './reportRedaction.ts'

test('non-strings report nothing', () => {
  assert.equal(sanitizeReportText(undefined), undefined)
  assert.equal(sanitizeReportText(null), undefined)
  assert.equal(sanitizeReportText(42), undefined)
})

test('bearer tokens and provider keys are redacted', () => {
  assert.equal(
    sanitizeReportText('failed: Bearer eyJhbGciOi.J9.abc-_~+/='),
    'failed: Bearer [redacted]',
  )
  assert.equal(sanitizeReportText('token ghp_ABCdef0123456789'), 'token [redacted_key]')
  assert.equal(sanitizeReportText('token xoxb-ABCdef0123456789'), 'token [redacted_key]')
})

test('DevOps credentials are redacted', () => {
  assert.equal(
    sanitizeReportText('AWS rejected AKIAIOSFODNN7EXAMPLE'),
    'AWS rejected [redacted_aws_access_key]',
  )
  assert.equal(
    sanitizeReportText('Authorization: Basic dXNlcjpwYXNzd29yZA=='),
    'Authorization: [redacted]',
  )
  assert.equal(
    sanitizeReportText('JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature123'),
    'JWT [redacted_jwt]',
  )
})

test('connection-string credentials are redacted', () => {
  assert.equal(
    sanitizeReportText('mongodb://admin:p%40ssword@db.example.com/app'),
    'mongodb://[redacted_credentials]@db.example.com/app',
  )
  assert.equal(
    sanitizeReportText('postgresql://user:secret@localhost:5432/db'),
    'postgresql://[redacted_credentials]@localhost:5432/db',
  )
})

test('secret assignments are redacted while retaining their field name', () => {
  const passwordField = ['pass', 'word'].join('')
  const passphraseField = ['pass', 'phrase'].join('')

  assert.equal(sanitizeReportText('password=hunter2'), 'password=[redacted]')
  assert.equal(sanitizeReportText('token: kube-token-value'), 'token: [redacted]')
  assert.equal(
    sanitizeReportText('{"client_secret":"super-secret"}'),
    '{"client_secret":"[redacted]"}',
  )
  assert.equal(
    sanitizeReportText('aws_secret_access_key = abc/123+secret'),
    'aws_secret_access_key = [redacted]',
  )
  assert.equal(
    sanitizeReportText(`${passwordField}="correct horse battery staple"`),
    `${passwordField}="[redacted]"`,
  )
  assert.equal(
    sanitizeReportText(`${passphraseField}='two words'`),
    `${passphraseField}='[redacted]'`,
  )
  assert.equal(
    sanitizeReportText(String.raw`${passwordField}="correct\" horse battery staple"`),
    `${passwordField}="[redacted]"`,
  )
  assert.equal(
    sanitizeReportText(`${passwordField}="unterminated secret\nrequest failed`),
    `${passwordField}="[redacted]\nrequest failed`,
  )
  assert.equal(sanitizeReportText('status=failed'), 'status=failed')
})

test('resource and correlation identifiers remain useful for debugging', () => {
  assert.equal(
    sanitizeReportText('Secret: default/my-tls-cert not found'),
    'Secret: default/my-tls-cert not found',
  )
  assert.equal(
    sanitizeReportText('session_id=550e8400-e29b-41d4-a716'),
    'session_id=550e8400-e29b-41d4-a716',
  )
})

test('PEM private keys and their trailing content are redacted', () => {
  const pem = [
    'unable to load -----BEGIN PRIVATE KEY-----',
    'c3VwZXItc2VjcmV0LWtleQ==',
    '-----END PRIVATE KEY----- from disk',
  ].join('\n')

  assert.equal(sanitizeReportText(pem), 'unable to load [redacted_private_key]')
})

test('an ordinary address is redacted whole', () => {
  assert.equal(
    sanitizeReportText('no mailbox for a.b@example.com'),
    'no mailbox for [redacted_email]',
  )
})

// The bound on the label-count quantifier exists only to keep the pattern from
// backtracking super-linearly. If it is set below the real DNS maximum the
// address matches *partially* and the tail — the part that identifies the
// domain, and therefore the org — survives into the PostHog payload. A bound of
// 8 shipped once; these cases are what catches that.
test('deeply nested domains are redacted whole, not partially', () => {
  for (const labels of [8, 9, 12, 40, 127]) {
    const domain = Array.from({ length: labels }, (_, i) => `l${i}`).join('.')
    const address = `user@${domain}`
    const out = sanitizeReportText(`connect failed for ${address}`)

    assert.equal(out, 'connect failed for [redacted_email]', `${labels} labels leaked: ${out}`)
    assert.ok(!out?.includes('l0'), `${labels} labels leaked a domain fragment: ${out}`)
  }
})

test('single-character labels at the DNS length limit are redacted whole', () => {
  // 127 one-octet labels is the longest legal name (253 octets).
  const domain = Array.from({ length: 127 }, () => 'a').join('.')

  assert.equal(sanitizeReportText(`x@${domain}`), '[redacted_email]')
})

test('a maximum-length local part is redacted whole', () => {
  const local = 'a'.repeat(64)

  assert.equal(sanitizeReportText(`${local}@example.com`), '[redacted_email]')
})

test('a maximum-length label is redacted whole', () => {
  const label = 'a'.repeat(63)

  assert.equal(sanitizeReportText(`x@${label}.com`), '[redacted_email]')
})

test('reported text is capped', () => {
  const out = sanitizeReportText('x'.repeat(MAX_REPORT_TEXT_LENGTH * 2))

  assert.equal(out?.length, MAX_REPORT_TEXT_LENGTH)
})
