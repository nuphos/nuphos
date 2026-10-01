import { generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import {
  AwsSnsValidationError,
  buildAwsSnsStringToSign,
  confirmAwsSnsSubscription,
  isAwsSnsValidationError,
  normalizeCloudWatchSnsNotification,
  parseAwsSnsEnvelope,
  shouldHandleAwsSnsRequest,
  validateAwsSnsCertificateUrl,
  validateAwsSnsConfirmationUrl,
  verifyAwsSnsSignature,
} from './sns-webhook'

import type { AwsSnsEnvelope } from './sns-webhook'

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

describe('AWS SNS webhook validation', () => {
  it('does not treat a generic webhook Type field as an SNS delivery', () => {
    expect(
      shouldHandleAwsSnsRequest({
        payloadType: 'third_party_event',
        triggerProvider: 'grafana',
      }),
    ).toBe(false)
    expect(
      shouldHandleAwsSnsRequest({
        payloadType: 'Notification',
        triggerProvider: 'aws',
      }),
    ).toBe(true)
    expect(
      shouldHandleAwsSnsRequest({
        headerMessageType: 'Notification',
        payloadType: undefined,
        triggerProvider: 'generic',
      }),
    ).toBe(true)
  })

  it('builds the documented notification string without a trailing newline', () => {
    expect(buildAwsSnsStringToSign(baseEnvelope)).toBe(
      [
        'Message',
        baseEnvelope.Message,
        'MessageId',
        baseEnvelope.MessageId,
        'Subject',
        baseEnvelope.Subject,
        'Timestamp',
        baseEnvelope.Timestamp,
        'TopicArn',
        baseEnvelope.TopicArn,
        'Type',
        baseEnvelope.Type,
      ].join('\n'),
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

  it('verifies a signature-v2 notification and rejects tampering', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(buildAwsSnsStringToSign(baseEnvelope)),
      privateKey,
    ).toString('base64')
    const signedEnvelope = { ...baseEnvelope, Signature: signature }

    await expect(
      verifyAwsSnsSignature(signedEnvelope, {
        expectedTopicArn: baseEnvelope.TopicArn,
        publicKeyLoader: async () => publicKey,
      }),
    ).resolves.toBeUndefined()
    await expect(
      verifyAwsSnsSignature(
        { ...signedEnvelope, Message: '{"AlarmName":"tampered","NewStateValue":"ALARM"}' },
        { publicKeyLoader: async () => publicKey },
      ),
    ).rejects.toBeInstanceOf(AwsSnsValidationError)
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
