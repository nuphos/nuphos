import { generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import {
  AwsSnsValidationError,
  buildAwsSnsStringToSign,
  confirmAwsSnsSubscription,
  isAwsSnsRequest,
  isAwsSnsValidationError,
  normalizeCloudWatchSnsNotification,
  parseAwsSnsEnvelope,
  validateAwsSnsCertificateUrl,
  validateAwsSnsConfirmationUrl,
  verifyAwsSnsSignature,
} from './sns-webhook'

import type { AwsSnsEnvelope } from './sns-webhook'
import type { KeyObject } from 'node:crypto'

const baseEnvelope: AwsSnsEnvelope = {
  Type: 'Notification',
  MessageId: 'message-1',
  TopicArn: 'arn:aws:sns:us-east-1:123456789012:nuphos-watch',
  Message: '{"AlarmName":"High CPU","NewStateValue":"ALARM"}',
  Timestamp: '2026-07-23T10:00:00.000Z',
  SignatureVersion: '2',
  Signature: 'placeholder',
  SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-example.pem',
  Subject: 'ALARM: "High CPU"',
}

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const length =
    body.length < 0x80
      ? Buffer.from([body.length])
      : Buffer.from([0x82, body.length >> 8, body.length & 0xff])

  return Buffer.concat([Buffer.from([tag]), length, body])
}

/** A minimal self-signed X.509 certificate, standing in for the SNS signing certificate. */
function selfSignedCertificatePem(privateKey: KeyObject, publicKey: KeyObject): string {
  const sequence = (...parts: Buffer[]) => der(0x30, ...parts)
  const sha256WithRsa = sequence(Buffer.from('06092a864886f70d01010b0500', 'hex'))
  const name = sequence(
    der(0x31, sequence(Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('sns.test')))),
  )
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.from([1])),
    sha256WithRsa,
    name,
    sequence(der(0x18, Buffer.from('20000101000000Z')), der(0x18, Buffer.from('20991231235959Z'))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
  )
  const certificate = sequence(
    tbs,
    sha256WithRsa,
    der(0x03, Buffer.from([0]), sign('sha256', tbs, privateKey)),
  )

  return `-----BEGIN CERTIFICATE-----\n${certificate.toString('base64')}\n-----END CERTIFICATE-----\n`
}

describe('AWS SNS webhook validation', () => {
  it('does not treat a generic webhook Type field as an SNS delivery', () => {
    expect(isAwsSnsRequest({ payload: { Type: 'third_party_event' } })).toBe(false)
    expect(isAwsSnsRequest({ payload: { Type: 'Notification', message: 'hi' } })).toBe(false)
    expect(isAwsSnsRequest({ payload: baseEnvelope })).toBe(true)
    expect(isAwsSnsRequest({ headerMessageType: 'Notification', payload: undefined })).toBe(true)
  })

  it('builds the documented notification string with a newline after every key and value', () => {
    expect(buildAwsSnsStringToSign(baseEnvelope)).toBe(
      'Message\n{"AlarmName":"High CPU","NewStateValue":"ALARM"}\n' +
        'MessageId\nmessage-1\n' +
        'Subject\nALARM: "High CPU"\n' +
        'Timestamp\n2026-07-23T10:00:00.000Z\n' +
        'TopicArn\narn:aws:sns:us-east-1:123456789012:nuphos-watch\n' +
        'Type\nNotification\n',
    )
  })

  it('rejects untrusted certificate and confirmation URLs', () => {
    expect(() =>
      validateAwsSnsCertificateUrl(
        'https://sns.us-east-1.amazonaws.com.evil.test/SimpleNotificationService-x.pem',
      ),
    ).toThrow('Untrusted')
    expect(() =>
      validateAwsSnsCertificateUrl(
        'http://sns.us-east-1.amazonaws.com/SimpleNotificationService-x.pem',
      ),
    ).toThrow('Untrusted')

    const confirmation = parseAwsSnsEnvelope({
      ...baseEnvelope,
      Type: 'SubscriptionConfirmation',
      Token: 'token-1',
      SubscribeURL:
        'https://169.254.169.254/?Action=ConfirmSubscription&TopicArn=arn%3Aaws%3Asns%3Aus-east-1%3A123456789012%3Anuphos-watch&Token=token-1',
    })

    expect(() => validateAwsSnsConfirmationUrl(confirmation)).toThrow('Untrusted')
  })

  it('verifies messages signed the way AWS signs them and rejects tampering', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const certificatePem = selfSignedCertificatePem(privateKey, publicKey)
    const certificateFetch = (async () => new Response(certificatePem)) as unknown as typeof fetch
    const confirmation: AwsSnsEnvelope = {
      ...baseEnvelope,
      Type: 'SubscriptionConfirmation',
      Subject: undefined,
      Token: 'token-1',
      SubscribeURL:
        'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn%3Aaws%3Asns%3Aus-east-1%3A123456789012%3Anuphos-watch&Token=token-1',
    }

    for (const envelope of [baseEnvelope, confirmation]) {
      for (const version of ['1', '2'] as const) {
        // AWS signs each key and each value followed by a newline, including the last one.
        const keys: (keyof AwsSnsEnvelope)[] =
          envelope.Type === 'Notification'
            ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
            : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
        const stringToSign = keys.map((key) => `${key}\n${String(envelope[key])}\n`).join('')
        const signed: AwsSnsEnvelope = {
          ...envelope,
          SignatureVersion: version,
          SigningCertURL:
            'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-selfsigned.pem',
          Signature: sign(
            version === '1' ? 'RSA-SHA1' : 'RSA-SHA256',
            Buffer.from(stringToSign),
            privateKey,
          ).toString('base64'),
        }

        await expect(
          verifyAwsSnsSignature(signed, { fetchImpl: certificateFetch }),
        ).resolves.toBeUndefined()
        await expect(
          verifyAwsSnsSignature(
            { ...signed, Message: '{"AlarmName":"tampered","NewStateValue":"ALARM"}' },
            { fetchImpl: certificateFetch },
          ),
        ).rejects.toBeInstanceOf(AwsSnsValidationError)
      }
    }
  })

  it('keeps transient certificate and confirmation failures retryable', async () => {
    const certificateFetch = (async () => {
      throw new Error('temporary certificate network failure')
    }) as unknown as typeof fetch
    let certificateError: unknown

    try {
      await verifyAwsSnsSignature(
        {
          ...baseEnvelope,
          SigningCertURL:
            'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-transient.pem',
        },
        { fetchImpl: certificateFetch },
      )
    } catch (error) {
      certificateError = error
    }
    expect(certificateError).toBeInstanceOf(Error)
    expect(isAwsSnsValidationError(certificateError)).toBe(false)

    const confirmation = parseAwsSnsEnvelope({
      ...baseEnvelope,
      Type: 'SubscriptionConfirmation',
      Token: 'token-1',
      SubscribeURL:
        'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn%3Aaws%3Asns%3Aus-east-1%3A123456789012%3Anuphos-watch&Token=token-1',
    })
    const unavailableFetch = (async () =>
      new Response('', { status: 503 })) as unknown as typeof fetch
    let confirmationError: unknown

    try {
      await confirmAwsSnsSubscription(confirmation, unavailableFetch)
    } catch (error) {
      confirmationError = error
    }
    expect(confirmationError).toBeInstanceOf(Error)
    expect(isAwsSnsValidationError(confirmationError)).toBe(false)
  })

  it('classifies deterministic SNS rejections as validation errors', async () => {
    expect(() => parseAwsSnsEnvelope({})).toThrow(AwsSnsValidationError)
    const confirmation = parseAwsSnsEnvelope({
      ...baseEnvelope,
      Type: 'SubscriptionConfirmation',
      Token: 'token-1',
      SubscribeURL:
        'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn%3Aaws%3Asns%3Aus-east-1%3A123456789012%3Anuphos-watch&Token=token-1',
    })
    const forbiddenFetch = (async () =>
      new Response('', { status: 403 })) as unknown as typeof fetch

    await expect(confirmAwsSnsSubscription(confirmation, forbiddenFetch)).rejects.toBeInstanceOf(
      AwsSnsValidationError,
    )
  })
})

describe('CloudWatch SNS normalization', () => {
  it('normalizes ALARM and OK notifications for the trigger lifecycle', () => {
    const firing = normalizeCloudWatchSnsNotification({
      ...baseEnvelope,
      Message: JSON.stringify({
        AlarmName: 'High CPU',
        AlarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:High CPU',
        OldStateValue: 'OK',
        NewStateValue: 'ALARM',
        NewStateReason: 'Threshold Crossed',
        StateChangeTime: '2026-07-23T10:00:00.000Z',
        Region: 'US East (N. Virginia)',
        Trigger: { MetricName: 'CPUUtilization' },
      }),
    })

    expect(firing.status).toBe('firing')
    expect(firing.alarm.name).toBe('High CPU')
    expect(firing.alarm.trigger).toEqual({ MetricName: 'CPUUtilization' })

    const resolved = normalizeCloudWatchSnsNotification({
      ...baseEnvelope,
      Message: JSON.stringify({ AlarmName: 'High CPU', NewStateValue: 'OK' }),
    })

    expect(resolved.status).toBe('resolved')
  })
})
