const required = [
  'MONGODB_URI',
  'NUPHOS_JWT_SECRET',
  'NUPHOS_PUBLIC_BACKEND_URL',
  'ZSEND_API_KEY',
  'NUPHOS_EMAIL_FROM',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_TRANSFER_BUCKET',
  'R2_SKILLS_BUCKET',
] as const

export type Settings = Record<(typeof required)[number], string>

export function containerEnv(env: Settings): Record<string, string> {
  for (const name of required) {
    if (!env[name] || env[name].startsWith('REPLACE_')) throw new Error(`Missing ${name}`)
  }
  for (const name of ['NUPHOS_PUBLIC_BACKEND_URL', 'R2_ENDPOINT'] as const) {
    const url = new URL(env[name])
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error(`${name} must be an HTTPS origin`)
    }
  }
  return {
    NODE_ENV: 'production',
    PORT: '3000',
    MONGODB_URI: env.MONGODB_URI,
    MONGODB_DB: 'nuphos',
    NUPHOS_JWT_SECRET: env.NUPHOS_JWT_SECRET,
    NUPHOS_AUTH_BASE_URL: env.NUPHOS_PUBLIC_BACKEND_URL,
    NUPHOS_BACKEND_URL: env.NUPHOS_PUBLIC_BACKEND_URL,
    NUPHOS_PUBLIC_BACKEND_URL: env.NUPHOS_PUBLIC_BACKEND_URL,
    ZSEND_API_KEY: env.ZSEND_API_KEY,
    NUPHOS_EMAIL_FROM: env.NUPHOS_EMAIL_FROM,
    ATLAS_REDIS_ENABLED: 'false',
    BRAINTRUST_TRACING_ENABLED: 'false',
    CLAUDE_CODE_RUNTIME_KUBECTL: 'false',
    CLAUDE_CODE_RUNTIME_PROVISIONER_ENABLED: 'false',
    NUPHOS_FILE_TRANSFER_S3_BUCKET: env.R2_TRANSFER_BUCKET,
    NUPHOS_FILE_TRANSFER_S3_REGION: 'auto',
    NUPHOS_FILE_TRANSFER_S3_ENDPOINT: env.R2_ENDPOINT,
    NUPHOS_FILE_TRANSFER_S3_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    NUPHOS_FILE_TRANSFER_S3_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    ATLAS_SKILLS_BUCKET: env.R2_SKILLS_BUCKET,
    ATLAS_SKILLS_S3_REGION: 'auto',
    ATLAS_SKILLS_S3_ENDPOINT: env.R2_ENDPOINT,
    ATLAS_SKILLS_S3_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    ATLAS_SKILLS_S3_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
  }
}
