import { createVerify, X509Certificate } from 'node:crypto'

import {
  buildAwsSnsStringToSign,
  invalidSns,
  isAwsSnsValidationError,
  snsHttpError,
  validateAwsSnsCertificateUrl,
  validateAwsSnsConfirmationUrl,
} from './envelope'

import type { AwsSnsEnvelope } from './envelope'
import type { KeyObject } from 'node:crypto'

const MAX_CERTIFICATE_BYTES = 64 * 1024
const CERTIFICATE_CACHE_TTL_MS = 60 * 60 * 1000
const certificateCache = new Map<string, { publicKey: KeyObject; expiresAt: number }>()

export type NormalizedCloudWatchSnsPayload = {
  provider: 'aws_cloudwatch'
  status: 'firing' | 'resolved' | 'unknown'
  state: string
  alarm: {
    name: string
    arn?: string
    oldState?: string
    newState: string
    reason?: string
    stateChangedAt?: string
    region?: string
    trigger?: Record<string, unknown>
  }
  sns: {
    messageId: string
    topicArn: string
    timestamp: string
    subject?: string
  }
}

async function loadAwsSnsCertificatePublicKey(
  signingCertUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyObject> {
  const url = validateAwsSnsCertificateUrl(signingCertUrl)
  const cached = certificateCache.get(url.href)

  if (cached && cached.expiresAt > Date.now()) return cached.publicKey

  const response = await fetchImpl(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw snsHttpError('Could not load SNS signing certificate', response.status)
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0)

  if (contentLength > MAX_CERTIFICATE_BYTES) {
    invalidSns('SNS signing certificate is too large')
  }
  const certificatePem = await response.text()

  if (Buffer.byteLength(certificatePem, 'utf8') > MAX_CERTIFICATE_BYTES) {
    invalidSns('SNS signing certificate is too large')
  }
  let certificate: X509Certificate

  try {
    certificate = new X509Certificate(certificatePem)
  } catch {
    invalidSns('SNS signing certificate is invalid')
  }
  const now = Date.now()

  if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo)) {
    invalidSns('SNS signing certificate is expired or not yet valid')
  }
  const publicKey = certificate.publicKey

  certificateCache.set(url.href, {
    publicKey,
    expiresAt: Math.min(now + CERTIFICATE_CACHE_TTL_MS, Date.parse(certificate.validTo)),
  })

  return publicKey
}

export async function verifyAwsSnsSignature(
  envelope: AwsSnsEnvelope,
  options: {
    expectedTopicArn?: string
    fetchImpl?: typeof fetch
    publicKeyLoader?: (signingCertUrl: string) => Promise<KeyObject>
  } = {},
): Promise<void> {
  validateAwsSnsCertificateUrl(envelope.SigningCertURL)
  if (options.expectedTopicArn && envelope.TopicArn !== options.expectedTopicArn) {
    invalidSns('Unexpected SNS topic')
  }
  const publicKey = options.publicKeyLoader
    ? await options.publicKeyLoader(envelope.SigningCertURL)
    : await loadAwsSnsCertificatePublicKey(envelope.SigningCertURL, options.fetchImpl)
  const verifier = createVerify(envelope.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256')

  verifier.update(buildAwsSnsStringToSign(envelope), 'utf8')
  verifier.end()
  try {
    if (!verifier.verify(publicKey, envelope.Signature, 'base64')) {
      invalidSns('Invalid SNS message signature')
    }
  } catch (error) {
    if (isAwsSnsValidationError(error)) throw error
    invalidSns('Invalid SNS message signature')
  }
}

export async function confirmAwsSnsSubscription(
  envelope: AwsSnsEnvelope,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const confirmationUrl = validateAwsSnsConfirmationUrl(envelope)
  const response = await fetchImpl(confirmationUrl, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw snsHttpError('Could not confirm SNS subscription', response.status)
  }
}

function cloudWatchString(
  input: Record<string, unknown>,
  key: string,
  required = false,
): string | undefined {
  const value = input[key]

  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > 16_384) {
    invalidSns(`Invalid CloudWatch notification ${key}`)
  }

  return value
}

export function normalizeCloudWatchSnsNotification(
  envelope: AwsSnsEnvelope,
): NormalizedCloudWatchSnsPayload {
  if (envelope.Type !== 'Notification') {
    invalidSns('SNS envelope is not a notification')
  }
  let value: unknown

  try {
    value = JSON.parse(envelope.Message)
  } catch {
    invalidSns('SNS notification is not a CloudWatch alarm message')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidSns('SNS notification is not a CloudWatch alarm message')
  }
  const input = value as Record<string, unknown>
  const newState = cloudWatchString(input, 'NewStateValue', true)!
  const trigger =
    input.Trigger && typeof input.Trigger === 'object' && !Array.isArray(input.Trigger)
      ? (input.Trigger as Record<string, unknown>)
      : undefined

  return {
    provider: 'aws_cloudwatch',
    status: newState === 'ALARM' ? 'firing' : newState === 'OK' ? 'resolved' : 'unknown',
    state: newState,
    alarm: {
      name: cloudWatchString(input, 'AlarmName', true)!,
      arn: cloudWatchString(input, 'AlarmArn'),
      oldState: cloudWatchString(input, 'OldStateValue'),
      newState,
      reason: cloudWatchString(input, 'NewStateReason'),
      stateChangedAt: cloudWatchString(input, 'StateChangeTime'),
      region: cloudWatchString(input, 'Region'),
      trigger,
    },
    sns: {
      messageId: envelope.MessageId,
      topicArn: envelope.TopicArn,
      timestamp: envelope.Timestamp,
      subject: envelope.Subject,
    },
  }
}
