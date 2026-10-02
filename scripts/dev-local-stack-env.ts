// What a dev backend must be told so it runs on the local docker compose stack.
// Spawn env beats apps/backend/.env, so these win over whatever that file points at.
import { readFileSync } from 'node:fs'

export type LocalStack = {
  mongoPort: number
  rustfsPort: number
  runtimePort: number
  s3AccessKey: string
  s3SecretKey: string
}

const S3_BUCKETS = {
  fileTransfers: 'nuphos-file-transfers',
  skills: 'nuphos-skills',
  journal: 'nuphos-journal',
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const eq = line.indexOf('=')

    if (!line || line.startsWith('#') || eq <= 0) continue
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
  }

  return out
}

function port(value: string | undefined, fallback: number): number {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** Null when a secret init-env.sh generates is missing. */
export function localStackFromEnv(env: Record<string, string>): LocalStack | null {
  const { S3_ACCESS_KEY, S3_SECRET_KEY } = env

  if (!S3_ACCESS_KEY || !S3_SECRET_KEY) return null

  return {
    mongoPort: port(env.MONGO_PORT, 27117),
    rustfsPort: port(env.RUSTFS_PORT, 9000),
    runtimePort: port(env.RUNTIME_PORT, 18180),
    s3AccessKey: S3_ACCESS_KEY,
    s3SecretKey: S3_SECRET_KEY,
  }
}

export function readLocalStack(envPath: string): LocalStack | null {
  try {
    return localStackFromEnv(parseEnvFile(readFileSync(envPath, 'utf8')))
  } catch {
    return null
  }
}

export function localRuntimeUrl(stack: LocalStack): string {
  return `ws://localhost:${String(stack.runtimePort)}/acp`
}

export function localBackendEnv(stack: LocalStack): Record<string, string> {
  const s3 = `http://127.0.0.1:${String(stack.rustfsPort)}`

  return {
    NODE_ENV: 'development',
    // The local stack has one HTTP port, even when a shared .env enables TLS.
    ATLAS_DEV_TLS_CERT: '',
    ATLAS_DEV_TLS_KEY: '',
    NUPHOS_DEV_HTTP_PORT: '0',
    MONGODB_URI: `mongodb://127.0.0.1:${String(stack.mongoPort)}/?directConnection=true`,
    MONGODB_DB: 'nuphos',
    ATLAS_REDIS_ENABLED: 'false',
    CLAUDE_CODE_RUNTIME_KUBECTL: 'false',
    CLAUDE_CODE_RUNTIME_PROVISIONER_ENABLED: 'false',
    NUPHOS_DEV_EMAIL_OTP_LOG: 'true',
    NUPHOS_LOCAL_STACK: 'true',
    NUPHOS_FILE_TRANSFER_S3_BUCKET: S3_BUCKETS.fileTransfers,
    NUPHOS_FILE_TRANSFER_S3_REGION: 'us-east-1',
    NUPHOS_FILE_TRANSFER_S3_ENDPOINT: s3,
    NUPHOS_FILE_TRANSFER_S3_ACCESS_KEY_ID: stack.s3AccessKey,
    NUPHOS_FILE_TRANSFER_S3_SECRET_ACCESS_KEY: stack.s3SecretKey,
    ATLAS_SKILLS_BUCKET: S3_BUCKETS.skills,
    ATLAS_SKILLS_S3_REGION: 'us-east-1',
    ATLAS_SKILLS_S3_ENDPOINT: s3,
    ATLAS_SKILLS_S3_ACCESS_KEY_ID: stack.s3AccessKey,
    ATLAS_SKILLS_S3_SECRET_ACCESS_KEY: stack.s3SecretKey,
    JOURNAL_S3_BUCKET: S3_BUCKETS.journal,
    JOURNAL_S3_REGION: 'us-east-1',
    JOURNAL_S3_ENDPOINT: s3,
    JOURNAL_AWS_ACCESS_KEY_ID: stack.s3AccessKey,
    JOURNAL_AWS_SECRET_ACCESS_KEY: stack.s3SecretKey,
  }
}
