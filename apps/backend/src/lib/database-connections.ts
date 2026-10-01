import type {
  DatabaseAgentPolicy,
  DatabaseConnectionAccess,
  DatabaseConnectionHealth,
  DatabaseEngine,
  DatabaseErrorCategory,
  DatabaseHealthStatus,
} from '@/models'

export function databaseConnectionHealthIsStorable(
  health: Pick<DatabaseConnectionHealth, 'status'>,
): boolean {
  return health.status === 'healthy'
}

export function canAccessDatabaseConnection(
  access: Pick<DatabaseConnectionAccess, 'memberAllowList'>,
  userId: string,
  teamRole: string,
): boolean {
  return (
    teamRole === 'ADMINISTRATOR' ||
    access.memberAllowList.includes('*') ||
    access.memberAllowList.includes(userId)
  )
}

export function databaseAgentPolicyAllows(
  policy: DatabaseAgentPolicy,
  operation: 'metadata' | 'query',
): boolean {
  if (policy === 'disabled') return false

  return operation === 'metadata' || policy === 'read-only'
}

export type ParsedDatabaseConnection = {
  engine: Exclude<DatabaseEngine, 'mysql'>
  connectionUri: string
  endpoint: string
  databaseName: string | null
  tls: { enabled: boolean; mode: string }
  username: string | null
}

const URI_PATTERN = /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^\s"'<>]+/gi
const KEY_VALUE_SECRET_PATTERN =
  /\b(password|passwd|pwd|secret|token|connection[_-]?string|uri)\s*[:=]\s*([^\s,;]+)/gi

export function redactDatabaseSecrets(value: string, secrets: string[] = []): string {
  let redacted = value.replace(URI_PATTERN, '[REDACTED_DATABASE_URI]')

  redacted = redacted.replace(KEY_VALUE_SECRET_PATTERN, '$1=[REDACTED]')
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    redacted = redacted.split(secret).join('[REDACTED]')
  }

  return redacted
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('Connection URI contains invalid percent encoding')
  }
}

function parseMongoUri(connectionUri: string): ParsedDatabaseConnection {
  const match = /^(mongodb(?:\+srv)?):\/\/([^/?#]*)(\/[^?#]*)?(?:\?([^#]*))?$/i.exec(connectionUri)

  if (!match) throw new Error('Invalid MongoDB connection URI')
  const scheme = match[1]!.toLowerCase()
  const authority = match[2]!
  const at = authority.lastIndexOf('@')
  const userInfo = at >= 0 ? authority.slice(0, at) : ''
  const hostsPart = at >= 0 ? authority.slice(at + 1) : authority

  if (!hostsPart) throw new Error('MongoDB connection URI must include a host')

  const hosts = splitMongoHosts(hostsPart)

  if (scheme === 'mongodb+srv' && (hosts.length !== 1 || hosts[0]!.includes(':'))) {
    throw new Error('mongodb+srv connection URI must contain one hostname without a port')
  }
  for (const host of hosts) validateHostPort(host, scheme === 'mongodb+srv' ? null : 27017)

  const username = userInfo ? decodeComponent(userInfo.split(':', 1)[0]!) : null
  const databaseName = decodeComponent((match[3] ?? '').replace(/^\//, '')) || null
  const params = new URLSearchParams(match[4] ?? '')
  const tlsValue = (params.get('tls') ?? params.get('ssl'))?.toLowerCase()
  const tlsEnabled = scheme === 'mongodb+srv' || tlsValue === 'true' || tlsValue === '1'
  const dbPath = databaseName ? `/${encodeURIComponent(databaseName)}` : ''

  return {
    engine: 'mongodb',
    connectionUri,
    endpoint: `${scheme}://${hostsPart}${dbPath}`,
    databaseName,
    tls: {
      enabled: tlsEnabled,
      mode: tlsEnabled ? (scheme === 'mongodb+srv' ? 'srv-default' : 'enabled') : 'disabled',
    },
    username,
  }
}

function splitMongoHosts(value: string): string[] {
  const hosts: string[] = []
  let start = 0
  let bracketDepth = 0

  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '[') bracketDepth += 1
    if (value[i] === ']') bracketDepth -= 1
    if (value[i] === ',' && bracketDepth === 0) {
      hosts.push(value.slice(start, i))
      start = i + 1
    }
  }
  hosts.push(value.slice(start))
  if (bracketDepth !== 0 || hosts.some((host) => !host)) {
    throw new Error('MongoDB connection URI contains an invalid host list')
  }

  return hosts
}

function validateHostPort(value: string, defaultPort: number | null): void {
  let url: URL

  try {
    url = new URL(`http://${value}`)
  } catch {
    throw new Error('Connection URI contains an invalid host or port')
  }
  if (!url.hostname || url.username || url.password || url.pathname !== '/') {
    throw new Error('Connection URI contains an invalid host or port')
  }
  if (!url.port && defaultPort === null && value.includes(':')) {
    throw new Error('Connection URI contains an invalid port')
  }
}

function parsePostgresUri(connectionUri: string): ParsedDatabaseConnection {
  let url: URL

  try {
    url = new URL(connectionUri)
  } catch {
    throw new Error('Invalid PostgreSQL connection URI')
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('PostgreSQL connection URI must use postgres:// or postgresql://')
  }
  if (!url.hostname) throw new Error('PostgreSQL connection URI must include a host')
  const databaseName = decodeComponent(url.pathname.replace(/^\//, '')) || null
  const sslMode = (url.searchParams.get('sslmode') ?? 'disable').toLowerCase()
  const tlsEnabled = ['allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslMode)
  const host = url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname
  const dbPath = databaseName ? `/${encodeURIComponent(databaseName)}` : ''

  return {
    engine: 'postgresql',
    connectionUri,
    endpoint: `${url.protocol}//${host}:${url.port || '5432'}${dbPath}`,
    databaseName,
    tls: { enabled: tlsEnabled, mode: sslMode },
    username: url.username ? decodeComponent(url.username) : null,
  }
}

export function parseDatabaseConnection(
  engine: DatabaseEngine,
  connectionUri: string,
): ParsedDatabaseConnection {
  const uri = connectionUri

  if (!uri || /[\p{Cc}\s]/u.test(uri)) {
    throw new Error('Connection URI must be a single non-empty URI without whitespace')
  }
  if (engine === 'mysql') {
    throw new Error('MySQL is reserved by the connection model but is not supported in phase one')
  }

  return engine === 'mongodb' ? parseMongoUri(uri) : parsePostgresUri(uri)
}

type ErrorLike = {
  code?: string | number
  name?: string
  message?: string
  cause?: unknown
}

function errorChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = []
  let current = error
  const seen = new Set<unknown>()

  while (current && typeof current === 'object' && !seen.has(current) && chain.length < 8) {
    seen.add(current)
    const item = current as ErrorLike

    chain.push(item)
    current = item.cause
  }

  return chain
}

export function classifyDatabaseError(error: unknown): {
  status: DatabaseHealthStatus
  category: DatabaseErrorCategory
  message: string
} {
  const chain = errorChain(error)
  const codes = new Set(chain.map((item) => String(item.code ?? '').toUpperCase()))
  const text = chain
    .map((item) => `${item.name ?? ''} ${item.message ?? ''}`)
    .join(' ')
    .toLowerCase()

  if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN') || /getaddrinfo|dns/.test(text)) {
    return {
      status: 'unreachable',
      category: 'dns',
      message: 'The database hostname could not be resolved.',
    }
  }
  if (/certificate|hostname.*match|tls|ssl|self signed/.test(text)) {
    return {
      status: 'unreachable',
      category: 'tls',
      message: 'TLS negotiation with the database failed.',
    }
  }
  if (
    codes.has('18') ||
    codes.has('28P01') ||
    /authentication failed|bad auth|invalid password/.test(text)
  ) {
    return {
      status: 'auth-failed',
      category: 'authentication',
      message: 'The database rejected the configured credentials.',
    }
  }
  if (
    codes.has('13') ||
    codes.has('42501') ||
    /not authorized|permission denied|insufficient privilege/.test(text)
  ) {
    return {
      status: 'permission-denied',
      category: 'authorization',
      message: 'The database account lacks the permissions required for the health check.',
    }
  }
  if (
    codes.has('3D000') ||
    /database .* does not exist|database unavailable|shutdown|recovering/.test(text)
  ) {
    return {
      status: 'unreachable',
      category: 'database-unavailable',
      message: 'The target database is unavailable.',
    }
  }
  if (
    codes.has('ECONNREFUSED') ||
    codes.has('ETIMEDOUT') ||
    codes.has('EHOSTUNREACH') ||
    codes.has('ENETUNREACH') ||
    /timed? ?out|server selection/.test(text)
  ) {
    return {
      status: 'unreachable',
      category: 'route',
      message: 'The database network route is unavailable or timed out.',
    }
  }

  return {
    status: 'unknown',
    category: 'unknown',
    message: 'The database health check failed for an unknown reason.',
  }
}
