/** A deterministic sender error that SNS should not retry. */
export class AwsSnsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AwsSnsValidationError'
  }
}

export function isAwsSnsValidationError(error: unknown): error is AwsSnsValidationError {
  return error instanceof AwsSnsValidationError
}

/**
 * SNS always sends the x-amz-sns-message-type header. The body fallback is
 * limited to AWS Watches for compatibility with intermediaries that strip it;
 * a generic webhook payload is allowed to use its own top-level `Type` field.
 */
export function shouldHandleAwsSnsRequest(input: {
  headerMessageType?: string
  payloadType?: unknown
  triggerProvider?: string
}): boolean {
  return (
    Boolean(input.headerMessageType) ||
    (input.triggerProvider === 'aws' && typeof input.payloadType === 'string')
  )
}

export function invalidSns(message: string): never {
  throw new AwsSnsValidationError(message)
}

export function snsHttpError(message: string, status: number): Error {
  const detail = `${message}: HTTP ${String(status)}`

  return status === 429 || status >= 500 ? new Error(detail) : new AwsSnsValidationError(detail)
}

export type AwsSnsMessageType =
  'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation'

export type AwsSnsEnvelope = {
  Type: AwsSnsMessageType
  MessageId: string
  TopicArn: string
  Message: string
  Timestamp: string
  SignatureVersion: '1' | '2'
  Signature: string
  SigningCertURL: string
  Subject?: string
  Token?: string
  SubscribeURL?: string
  UnsubscribeURL?: string
}

function requiredString(input: Record<string, unknown>, key: string, maxLength: number): string {
  const value = input[key]

  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    invalidSns(`Invalid SNS ${key}`)
  }

  return value
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  const value = input[key]

  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    invalidSns(`Invalid SNS ${key}`)
  }

  return value
}

export function parseAwsSnsEnvelope(value: unknown): AwsSnsEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidSns('Invalid SNS envelope')
  }
  const input = value as Record<string, unknown>
  const type = requiredString(input, 'Type', 64)

  if (
    type !== 'Notification' &&
    type !== 'SubscriptionConfirmation' &&
    type !== 'UnsubscribeConfirmation'
  ) {
    invalidSns('Unsupported SNS message type')
  }
  const signatureVersion = requiredString(input, 'SignatureVersion', 8)

  if (signatureVersion !== '1' && signatureVersion !== '2') {
    invalidSns('Unsupported SNS signature version')
  }
  const timestamp = requiredString(input, 'Timestamp', 64)

  if (!Number.isFinite(Date.parse(timestamp))) {
    invalidSns('Invalid SNS Timestamp')
  }

  const envelope: AwsSnsEnvelope = {
    Type: type,
    MessageId: requiredString(input, 'MessageId', 512),
    TopicArn: requiredString(input, 'TopicArn', 2048),
    Message: requiredString(input, 'Message', 1024 * 1024),
    Timestamp: timestamp,
    SignatureVersion: signatureVersion,
    Signature: requiredString(input, 'Signature', 4096),
    SigningCertURL: requiredString(input, 'SigningCertURL', 4096),
    Subject: optionalString(input, 'Subject', 1024),
    Token: optionalString(input, 'Token', 8192),
    SubscribeURL: optionalString(input, 'SubscribeURL', 8192),
    UnsubscribeURL: optionalString(input, 'UnsubscribeURL', 8192),
  }

  if (
    (type === 'SubscriptionConfirmation' || type === 'UnsubscribeConfirmation') &&
    (!envelope.Token || !envelope.SubscribeURL)
  ) {
    invalidSns(`Invalid SNS ${type} envelope`)
  }

  return envelope
}

export function buildAwsSnsStringToSign(envelope: AwsSnsEnvelope): string {
  const fields: [string, string | undefined][] =
    envelope.Type === 'Notification'
      ? [
          ['Message', envelope.Message],
          ['MessageId', envelope.MessageId],
          ['Subject', envelope.Subject],
          ['Timestamp', envelope.Timestamp],
          ['TopicArn', envelope.TopicArn],
          ['Type', envelope.Type],
        ]
      : [
          ['Message', envelope.Message],
          ['MessageId', envelope.MessageId],
          ['SubscribeURL', envelope.SubscribeURL],
          ['Timestamp', envelope.Timestamp],
          ['Token', envelope.Token],
          ['TopicArn', envelope.TopicArn],
          ['Type', envelope.Type],
        ]

  return fields
    .filter((field): field is [string, string] => field[1] !== undefined)
    .flatMap(([key, value]) => [key, value])
    .join('\n')
}

function isTrustedSnsHost(hostname: string): boolean {
  return (
    hostname === 'sns.amazonaws.com' ||
    /^sns(?:-fips)?\.[a-z0-9-]+\.amazonaws\.com$/.test(hostname) ||
    /^sns\.[a-z0-9-]+\.amazonaws\.com\.cn$/.test(hostname)
  )
}

export function validateAwsSnsCertificateUrl(value: string): URL {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    invalidSns('Untrusted SNS signing certificate URL')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !isTrustedSnsHost(url.hostname) ||
    !/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    invalidSns('Untrusted SNS signing certificate URL')
  }

  return url
}

export function validateAwsSnsConfirmationUrl(envelope: AwsSnsEnvelope): URL {
  if (!envelope.SubscribeURL || !envelope.Token) {
    invalidSns('SNS confirmation URL or token is missing')
  }
  let url: URL

  try {
    url = new URL(envelope.SubscribeURL)
  } catch {
    invalidSns('Untrusted SNS subscription confirmation URL')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !isTrustedSnsHost(url.hostname) ||
    url.pathname !== '/' ||
    url.hash ||
    url.searchParams.get('Action') !== 'ConfirmSubscription' ||
    url.searchParams.get('TopicArn') !== envelope.TopicArn ||
    url.searchParams.get('Token') !== envelope.Token
  ) {
    invalidSns('Untrusted SNS subscription confirmation URL')
  }

  return url
}
